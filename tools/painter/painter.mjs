// 讓手機上的洋蔥地圖，叫這台電腦登入的 Codex CLI 畫圖。
// 手機送一張沒有字、沒有路線的地圖底稿來，這裡排隊畫，畫好放著等手機來拿。
// 介面寫在 docs/模組約定.md「畫圖服務的介面」，server/painter 是同一套介面的雲端版。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import qrcode from 'qrcode-terminal';
import { MODEL, PaintError, codexVersion, findCodex, killTree, paintWithCodex } from './codex.mjs';
import { fakePaint, sniff } from './images.mjs';
import { promptFor } from './prompts.mjs';

const PORT = Number(process.env.PORT) || 8790;
const FAKE = process.env.ONION_FAKE === '1';
const FAKE_MS = Number(process.env.ONION_FAKE_MS) || 3000;
const BODY_MAX = 12 * 1024 * 1024;
const SIDE_MIN = 256;
const SIDE_MAX = 2048;
// 一次畫一張，後面最多再排這麼多張
const WAIT_MAX = 3;
const KEEP_MS = 24 * 60 * 60 * 1000;

const HOME = process.env.ONION_HOME || path.join(os.homedir(), '.onion-painter');
const JOBS = path.join(HOME, 'jobs');
// Codex 的工作資料夾要英文路徑。使用者名稱是中文的電腦，改放公用資料夾
const ASCII_HOME = /^[\x20-\x7e]+$/.test(HOME);
const WORK_ROOT = ASCII_HOME ? '' : path.join(process.env.PUBLIC || os.tmpdir(), 'onion-painter-work');

fs.mkdirSync(JOBS, { recursive: true });

function stamp() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}
function log(text) {
  console.log(`[${stamp()}] ${text}`);
}

// ---------- 密碼 ----------
// 第一次產生，之後一直用同一個，手機不用每次重掃。--new-token 換新的
function loadToken() {
  const file = path.join(HOME, 'token');
  if (!process.argv.includes('--new-token')) {
    try {
      const t = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{32}$/.test(t)) return t;
    } catch {
      /* 還沒有就產生 */
    }
  }
  const t = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

const sha = (s) => crypto.createHash('sha256').update(s).digest();
// 先 sha256 再比：兩邊一定一樣長，送什麼來 timingSafeEqual 都不會丟例外
function tokenOk(t) {
  return typeof t === 'string' && crypto.timingSafeEqual(sha(t), sha(TOKEN));
}

// ---------- 工作 ----------
// job：{id, kind, style, hash, status, created, started, ended, mime, ext, error}
const jobs = new Map();
const queue = [];
let current = null; // 正在畫的 job
let child = null; // 正在跑的 codex

const jobDir = (id) => path.join(JOBS, id);
const workDir = (id) => (WORK_ROOT ? path.join(WORK_ROOT, id) : path.join(jobDir(id), 'work'));

// 先寫到旁邊再換上去，寫到一半被關掉也不會留下半個檔
function saveJob(job) {
  const file = path.join(jobDir(job.id), 'job.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(job));
  fs.renameSync(`${file}.tmp`, file);
}

function rm(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* 有程式還開著就留給下一次清 */
  }
}

// 開機時把之前畫好的撿回來；關機那一刻還沒畫完的算失敗，不自動重畫，免得偷偷吃額度
function loadJobs() {
  for (const id of fs.readdirSync(JOBS)) {
    let job = null;
    try {
      job = JSON.parse(fs.readFileSync(path.join(jobDir(id), 'job.json'), 'utf8'));
    } catch {
      /* 壞掉的資料夾就清掉 */
    }
    if (!job || job.id !== id) {
      rm(jobDir(id));
      continue;
    }
    if (job.status === 'queued' || job.status === 'painting') {
      job.status = 'failed';
      job.error = '電腦上的程式重開過，這張要再畫一次';
      job.ended = Date.now();
      rm(workDir(id));
      saveJob(job);
    }
    jobs.set(id, job);
  }
  sweep();
}

function sweep() {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.ended && now - job.ended > KEEP_MS) {
      jobs.delete(job.id);
      rm(workDir(job.id));
      rm(jobDir(job.id));
    }
  }
}

function addJob(kind, style, img, info, hash) {
  const job = { id: crypto.randomBytes(8).toString('hex'), kind, style, hash, status: 'queued', created: Date.now() };
  job.input = `input.${info.ext}`;
  fs.mkdirSync(jobDir(job.id), { recursive: true });
  fs.mkdirSync(workDir(job.id), { recursive: true });
  fs.writeFileSync(path.join(workDir(job.id), job.input), img);
  saveJob(job);
  jobs.set(job.id, job);
  queue.push(job);
  return job;
}

async function paintOne(job) {
  const dir = workDir(job.id);
  if (FAKE) {
    await new Promise((r) => setTimeout(r, FAKE_MS));
    return fakePaint(fs.readFileSync(path.join(dir, job.input)));
  }
  if (!CODEX) throw new PaintError('電腦上找不到 Codex，先裝好再開');
  const onChild = (c) => (child = c);
  return paintWithCodex({ codex: CODEX, dir, input: job.input, prompt: promptFor(job.kind, job.style), onChild, log });
}

async function runNext() {
  if (current || !queue.length) return;
  const job = queue.shift();
  current = job;
  job.status = 'painting';
  job.started = Date.now();
  try {
    saveJob(job);
    log(`開始畫（${job.kind}）${queue.length ? `，後面還有 ${queue.length} 張` : ''}`);
    const buf = await paintOne(job);
    if (jobs.get(job.id) !== job) throw new PaintError('取消了');
    const info = sniff(buf);
    job.mime = info.mime;
    job.ext = info.ext;
    fs.writeFileSync(path.join(jobDir(job.id), `result.${info.ext}`), buf);
    job.status = 'done';
    job.ended = Date.now();
    log(`畫好了，花了 ${Math.round((job.ended - job.started) / 1000)} 秒，${info.w}×${info.h}`);
  } catch (e) {
    job.status = 'failed';
    job.ended = Date.now();
    job.error = e instanceof PaintError ? e.message : '電腦那頭出錯了，細節看終端機';
    const gone = jobs.get(job.id) !== job;
    log(gone ? '手機取消了這張' : `沒畫成：${job.error}`);
    if (!gone && (e.detail || !(e instanceof PaintError))) console.log(e.detail || e.stack);
  }
  child = null;
  current = null;
  // 底稿用完就刪，只留成品
  rm(workDir(job.id));
  try {
    if (jobs.get(job.id) === job) saveJob(job);
    else rm(jobDir(job.id));
  } catch (e) {
    log(`存不起來：${e.message}`);
  }
  runNext();
}

// ---------- HTTP ----------
// 網頁測試用的來源才放行；原生 app 的請求不帶 Origin
const ORIGIN = /^(http:\/\/(localhost|127\.0\.0\.1|([a-z0-9-]+\.)+localhost)(:\d{1,5})?|capacitor:\/\/localhost)$/i;

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  res.setHeader('Vary', 'Origin');
  if (!ORIGIN.test(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

function send(res, code, obj) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// 沒料到的例外：記在終端機，回 500，程式繼續跑
function oops(res, e) {
  log(`出錯了：${e && e.stack ? e.stack : e}`);
  try {
    send(res, 500, { error: '電腦那頭出錯了，細節看終端機' });
  } catch {
    res.destroy();
  }
}

function readBody(req, res, done) {
  const tooBig = () => send(res, 413, { error: '圖太大了，最多 12MB' });
  if (Number(req.headers['content-length']) > BODY_MAX) {
    tooBig();
    req.resume();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (d) => {
    const before = size;
    size += d.length;
    if (size <= BODY_MAX) chunks.push(d);
    else if (before <= BODY_MAX) tooBig();
    // 回完話還一直灌就斷掉
    if (size > BODY_MAX * 4) req.destroy();
  });
  req.on('end', () => {
    if (size > BODY_MAX) return;
    try {
      done(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      oops(res, e);
    }
  });
  req.on('error', () => {
    /* 連線斷掉就算了 */
  });
}

function parseImage(text) {
  const b64 = String(text).replace(/^data:image\/[a-z]+;base64,/, '');
  if (!/^[A-Za-z0-9+/\s]+={0,2}\s*$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  const info = sniff(buf);
  return info && { buf, info };
}

function postPaint(res, text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 下面一起擋 */
  }
  if (!data || typeof data.image !== 'string') return send(res, 400, { error: '看不懂手機送來的東西' });
  const kind = String(data.kind);
  const style = String(data.style || 'pencil');
  if (!promptFor(kind, style)) return send(res, 400, { error: '沒有這種畫法' });
  const img = parseImage(data.image);
  if (!img) return send(res, 400, { error: '這不是 PNG 或 JPEG 圖片' });
  const { w, h } = img.info;
  if (w > SIDE_MAX || h > SIDE_MAX || w < SIDE_MIN || h < SIDE_MIN) {
    return send(res, 400, { error: `圖的大小不對，邊長要在 ${SIDE_MIN} 到 ${SIDE_MAX} 之間` });
  }
  // 手機沒收到回應又送一次：同一張還在排或還在畫，就給同一個號碼，不要畫兩次
  const hash = sha(`${kind}/${style}/`).toString('hex').slice(0, 8) + sha(img.buf).toString('hex');
  for (const j of jobs.values()) {
    if (j.hash === hash && (j.status === 'queued' || j.status === 'painting')) return send(res, 202, { id: j.id });
  }
  if (queue.length >= WAIT_MAX) return send(res, 429, { error: '前面還有好幾張在排，等一下再試' });
  const job = addJob(kind, style, img.buf, img.info, hash);
  log(`收到一張底稿（${kind}，${w}×${h}）`);
  send(res, 202, { id: job.id });
  runNext();
}

function getJob(res, job) {
  const out = { status: job.status, ahead: 0, seconds: 0 };
  if (job.status === 'queued') out.ahead = queue.indexOf(job) + (current ? 1 : 0);
  // 還在排：等了幾秒；在畫：畫了幾秒；畫完：總共畫了幾秒
  out.seconds = Math.max(0, Math.round(((job.ended || Date.now()) - (job.started || job.created)) / 1000));
  if (job.error) out.error = job.error;
  send(res, 200, out);
}

function getImage(res, job) {
  if (job.status !== 'done') return send(res, 409, { error: '還沒畫好' });
  let buf;
  try {
    buf = fs.readFileSync(path.join(jobDir(job.id), `result.${job.ext}`));
  } catch {
    return send(res, 404, { error: '這張圖不見了，再畫一次' });
  }
  send(res, 200, { image: buf.toString('base64'), mime: job.mime });
}

function deleteJob(res, job) {
  jobs.delete(job.id);
  const i = queue.indexOf(job);
  if (i >= 0) queue.splice(i, 1);
  if (job === current) {
    // 資料夾等程式真的停了再由 runNext 清
    if (child) killTree(child);
  } else {
    rm(workDir(job.id));
    rm(jobDir(job.id));
  }
  send(res, 200, { ok: true });
}

function handle(req, res) {
  const fine = cors(req, res);
  if (req.method === 'OPTIONS') {
    req.resume();
    if (!fine) return send(res, 403, { error: '這個網頁不能用' });
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'X-Onion-Token, Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }
  if (!fine) {
    req.resume();
    return send(res, 403, { error: '這個網頁不能用' });
  }
  if (!tokenOk(req.headers['x-onion-token'])) {
    req.resume();
    return send(res, 401, { error: '密碼不對，重新掃一次電腦上的 QR' });
  }
  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return send(res, 400, { error: '網址看不懂' });
  }
  if (pathname === '/paint' && req.method === 'POST') {
    return readBody(req, res, (text) => postPaint(res, text));
  }
  req.resume();
  if (pathname === '/ping' && req.method === 'GET') {
    return send(res, 200, { ok: true, name: os.hostname(), kind: 'pc', engine: 'codex' });
  }
  const m = pathname.match(/^\/paint\/([0-9a-f]{16})(\/image)?$/);
  if (!m) return send(res, 404, { error: '沒有這個功能' });
  const job = jobs.get(m[1]);
  if (!job) return send(res, 404, { error: '找不到這張圖，可能已經過了一天' });
  if (req.method === 'GET') return m[2] ? getImage(res, job) : getJob(res, job);
  if (req.method === 'DELETE' && !m[2]) return deleteJob(res, job);
  send(res, 405, { error: '不能這樣用' });
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    oops(res, e);
  }
});
// 這是「把請求整個送完」的時限，12MB 走慢的 Wi-Fi 也夠
server.requestTimeout = 120 * 1000;
server.headersTimeout = 30 * 1000;

// ---------- 找區網 IP ----------
const VIRTUAL = /vethernet|virtualbox|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|hamachi|vpn|tap|tun|utun|veth|br-|bridge|npcap/i;

function privateRank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const m = ip.match(/^172\.(\d+)\./);
  return m && Number(m[1]) >= 16 && Number(m[1]) <= 31 ? 2 : 9;
}

function lanIps() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith('169.254.')) continue;
      all.push({ name, ip: a.address, rank: privateRank(a.address), virtual: VIRTUAL.test(name) });
    }
  }
  let pick = all.filter((x) => !x.virtual && x.rank < 9);
  if (!pick.length) pick = all.filter((x) => x.rank < 9);
  if (!pick.length) pick = all;
  return pick.sort((a, b) => a.rank - b.rank);
}

// ---------- 開機與關機 ----------
function pairUrl(ip) {
  const e = encodeURIComponent;
  return `onion://pair?u=${e(`http://${ip}:${PORT}`)}&t=${e(TOKEN)}&n=${e(os.hostname())}`;
}

function printBanner() {
  const ips = lanIps();
  console.log('');
  console.log('洋蔥地圖：用這台電腦畫圖');
  if (FAKE) console.log('現在是假畫圖模式，不會叫 Codex，也不吃額度');
  else console.log(`Codex：${VERSION}，模型 ${MODEL}`);
  console.log('');
  if (!ips.length) {
    console.log(`找不到區網 IP。這台電腦有連上 Wi-Fi 嗎？埠號 ${PORT}`);
    return;
  }
  console.log('手機打開洋蔥地圖，設定，畫圖，掃這個：');
  qrcode.generate(pairUrl(ips[0].ip), { small: true }, (q) => console.log(q));
  console.log('掃不到就把這一行貼到手機：');
  ips.forEach((x) => console.log(`${pairUrl(x.ip)}   （${x.name}）`));
  console.log('');
  console.log('手機跟電腦要連同一個 Wi-Fi。這個視窗要開著，按 Ctrl+C 結束');
  console.log('');
}

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  log('收到結束，關掉中…');
  if (child) killTree(child);
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`埠號 ${PORT} 已經有人在用，是不是已經開過一個了？關掉另一個，或換一個埠號（設 PORT=8791）`);
  else console.error(`伺服器開不起來：${e.message}`);
  process.exit(1);
});

const CODEX = FAKE ? null : findCodex();
const VERSION = CODEX ? (await codexVersion(CODEX)) || '（取不到版本，確認有登入）' : '（找不到，先裝好 Codex CLI 並登入）';
loadJobs();
setInterval(sweep, 60 * 60 * 1000).unref();
server.listen(PORT, '0.0.0.0', printBanner);
