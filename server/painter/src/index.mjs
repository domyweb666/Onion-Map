// 洋蔥地圖的雲端畫圖：介面跟 tools/painter 一樣，換成 Cloudflare Worker 加 OpenAI。
// 給沒有電腦的人用。介面寫在 docs/模組約定.md「畫圖服務的介面」。
//
// Worker     只檢查標頭、擋太快的 IP，把請求原封不動轉給下面兩個
// PaintJob   一張圖一個。用 alarm 去叫 OpenAI，手機不用一路連著；圖切成小塊存在自己的 SQLite
// PaintQuota 全站只有一個，記誰今天畫了幾張。同一個物件一次只處理一件事，所以總量不會超過
import { DurableObject } from 'cloudflare:workers';
import { promptFor } from './prompts.mjs';

const BODY_MAX = 12 * 1024 * 1024;
const SIDE_MIN = 256;
const SIDE_MAX = 2048;
const HOUR = 60 * 60 * 1000;
const KEEP_MS = 24 * HOUR;
const PAINT_MAX_MS = 5 * 60 * 1000;
const RETRY_MS = 20 * 1000;
// 最多叫 OpenAI 兩次，重跑也算在內，免得同一張付好幾次錢
const TRIES_MAX = 2;
// 失敗不扣張數，可是一天也不能無限試
const EXTRA_TRIES = 4;
const CHUNK = 1024 * 1024;

const num = (v, dflt) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : dflt);

// 台北時間的今天（台灣沒有日光節約，固定加 8 小時）
export const dayOf = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 10);

const json = (obj, status = 200) => Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, error) => json({ error }, status);

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 配額 ----------
export class PaintQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, day TEXT NOT NULL, device TEXT NOT NULL, refunded INTEGER NOT NULL DEFAULT 0)',
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS jobs_day ON jobs (day, device)');
  }

  count(day, device) {
    const used = 'COALESCE(SUM(1 - refunded), 0) AS used, COUNT(*) AS tries';
    if (!device) return this.sql.exec(`SELECT ${used} FROM jobs WHERE day = ?`, day).one();
    return this.sql.exec(`SELECT ${used} FROM jobs WHERE day = ? AND device = ?`, day, device).one();
  }

  look(device) {
    const day = dayOf(Date.now());
    const perDevice = num(this.env.DAILY_PER_DEVICE, 1);
    const total = num(this.env.DAILY_TOTAL, 50);
    const mine = this.count(day, device);
    const all = this.count(day);
    const left = Math.max(0, Math.min(perDevice - mine.used, total - all.used));
    return { day, perDevice, total, mine, all, left };
  }

  left(device) {
    return this.look(device).left;
  }

  // 先扣一張，畫失敗再還。中間沒有 await，所以兩個人同時來也不會一起過
  reserve(id, device) {
    const q = this.look(device);
    this.sql.exec('DELETE FROM jobs WHERE day < ?', dayOf(Date.now() - 2 * 24 * HOUR));
    if (q.mine.used >= q.perDevice) return { ok: false, error: '今天的張數用完了，明天再畫' };
    if (q.all.used >= q.total) return { ok: false, error: '今天大家畫的張數到上限了，明天再畫' };
    if (q.mine.tries >= q.perDevice + EXTRA_TRIES || q.all.tries >= q.total * 2 + EXTRA_TRIES) {
      return { ok: false, error: '今天試太多次了，明天再畫' };
    }
    this.sql.exec('INSERT INTO jobs (id, day, device) VALUES (?, ?, ?)', id, q.day, device);
    return { ok: true };
  }

  // 叫幾次都一樣，只會還一次，而且還的是當初扣的那一天
  refund(id) {
    this.sql.exec('UPDATE jobs SET refunded = 1 WHERE id = ?', id);
  }
}

// ---------- 一張圖 ----------
export class PaintJob extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.kv = ctx.storage.kv;
    this.abort = null;
  }

  get quota() {
    return this.env.QUOTA.getByName('main');
  }

  get job() {
    return this.kv.get('job');
  }

  set job(v) {
    this.kv.put('job', v);
  }

  // 長字串切塊存
  putText(name, text) {
    let n = 0;
    for (let i = 0; i < text.length; i += CHUNK) this.kv.put(`${name}:${n++}`, text.slice(i, i + CHUNK));
    this.kv.put(`${name}:n`, n);
  }

  getText(name) {
    const n = this.kv.get(`${name}:n`) || 0;
    let out = '';
    for (let i = 0; i < n; i += 1) out += this.kv.get(`${name}:${i}`);
    return out;
  }

  dropText(name) {
    const n = this.kv.get(`${name}:n`) || 0;
    for (let i = 0; i < n; i += 1) this.kv.delete(`${name}:${i}`);
    this.kv.delete(`${name}:n`);
  }

  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // POST /paint
  async fetch(request) {
    const id = request.headers.get('x-job');
    const device = request.headers.get('x-device');
    if (this.job) return fail(409, '這張已經送過了');
    const text = await readText(request.body);
    if (text === null) return fail(413, '圖太大了，最多 12MB');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 下面一起擋 */
    }
    if (!data || typeof data.image !== 'string') return fail(400, '看不懂手機送來的東西');
    const kind = String(data.kind);
    const style = String(data.style || 'pencil');
    if (!promptFor(kind, style)) return fail(400, '沒有這種畫法');
    const b64 = data.image.replace(/^data:image\/[a-z]+;base64,/, '').replace(/\s+/g, '');
    const info = sniff(b64);
    if (!info) return fail(400, '這不是 PNG 或 JPEG 圖片');
    if (info.w > SIDE_MAX || info.h > SIDE_MAX || info.w < SIDE_MIN || info.h < SIDE_MIN) {
      return fail(400, `圖的大小不對，邊長要在 ${SIDE_MIN} 到 ${SIDE_MAX} 之間`);
    }

    // 先記下來再去扣。扣完這裡就壞掉的話，一分鐘後的 alarm 會把那一張還回去
    const job = { id, device, kind, style, mime: info.mime, status: 'reserving', tries: 0, created: Date.now() };
    this.job = job;
    await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    const got = await this.quota.reserve(id, device);
    if (!got.ok) {
      await this.wipe();
      return fail(429, got.error);
    }
    this.putText('in', b64);
    this.job = { ...job, status: 'queued' };
    await this.ctx.storage.setAlarm(Date.now());
    return json({ id }, 202);
  }

  // 不是本人就當作沒有這張
  mine(device) {
    const job = this.job;
    return job && job.device === device ? job : null;
  }

  status(device) {
    const job = this.mine(device);
    if (!job) return null;
    const end = job.ended || Date.now();
    const out = {
      status: job.status === 'reserving' ? 'queued' : job.status,
      ahead: 0,
      seconds: Math.max(0, Math.round((end - (job.started || job.created)) / 1000)),
    };
    if (job.error) out.error = job.error;
    return out;
  }

  image(device) {
    const job = this.mine(device);
    if (!job) return null;
    if (job.status !== 'done') return { wait: true };
    return { image: this.getText('out'), mime: job.outMime };
  }

  // 還沒開始畫就刪，張數還回去；已經在畫的錢花了，不還
  async remove(device) {
    const job = this.mine(device);
    if (!job) return false;
    if (job.status === 'queued' || job.status === 'failed') await this.quota.refund(job.id);
    if (this.abort) this.abort.abort();
    await this.wipe();
    return true;
  }

  async alarm() {
    const job = this.job;
    if (!job) return this.wipe();
    if (job.status === 'reserving') {
      await this.quota.refund(job.id);
      return this.wipe();
    }
    if (job.status === 'queued' || job.status === 'painting') return this.paint(job);
    // 畫完或失敗的：該還的還掉，滿一天就整個清掉
    if (job.owe) {
      await this.quota.refund(job.id);
      this.job = { ...job, owe: false };
    }
    if (Date.now() >= job.ended + KEEP_MS) return this.wipe();
    await this.ctx.storage.setAlarm(job.ended + KEEP_MS);
  }

  async paint(old) {
    if (old.tries >= TRIES_MAX) return this.failed(old, '畫圖的服務現在很忙，等一下再試');
    const job = { ...old, status: 'painting', started: old.started || Date.now(), tries: old.tries + 1 };
    this.job = job;
    // 萬一這次跑到一半被系統收掉，之後還有人會接手
    await this.ctx.storage.setAlarm(Date.now() + PAINT_MAX_MS + 60 * 1000);
    this.abort = new AbortController();
    const r = await callOpenAI(this.env, job, this.getText('in'), this.abort.signal);
    this.abort = null;
    // 畫的時候手機把它刪了
    if (!this.job) return;
    if (r.image) {
      this.putText('out', r.image);
      this.dropText('in');
      this.job = { ...job, status: 'done', outMime: r.mime, ended: Date.now() };
      await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
      return;
    }
    if (r.retry && job.tries < TRIES_MAX) {
      await this.ctx.storage.setAlarm(Date.now() + RETRY_MS);
      return;
    }
    await this.failed(job, r.error);
  }

  async failed(job, error) {
    this.dropText('in');
    const done = { ...job, status: 'failed', error, ended: Date.now(), owe: true };
    this.job = done;
    // 還張數那一步沒成功的話，alarm 會再來一次
    await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    await this.quota.refund(job.id);
    this.job = { ...done, owe: false };
    await this.ctx.storage.setAlarm(done.ended + KEEP_MS);
  }
}

// ---------- OpenAI ----------
// 回 {image, mime} 或 {error, retry}。OpenAI 的原話只進記錄檔，不給手機
async function callOpenAI(env, job, b64, signal) {
  const model = env.IMAGE_MODEL || 'gpt-image-2.6-sunburst';
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', promptFor(job.kind, job.style));
  form.set('size', '1024x1536');
  form.set('quality', env.IMAGE_QUALITY || 'medium');
  form.set('n', '1');
  form.set('output_format', 'jpeg');
  form.set('output_compression', '92');
  // 只有第一代要自己講「照原圖」，後面的模型不收這個欄位
  if (/^gpt-image-1(\.5)?(-\d|$)/.test(model)) form.set('input_fidelity', 'high');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const name = job.mime === 'image/png' ? 'map.png' : 'map.jpg';
  form.append('image[]', new Blob([bytes], { type: job.mime }), name);

  let res;
  let body;
  try {
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAINT_MAX_MS)]),
    });
    body = await res.json();
  } catch (e) {
    if (e && e.name === 'TimeoutError') return { error: '畫太久了，先停下來，再試一次' };
    console.error('OpenAI 連不上', e && e.name);
    return { error: '畫圖的服務現在連不上，等一下再試', retry: true };
  }
  if (res.ok) {
    const image = body && body.data && body.data[0] && body.data[0].b64_json;
    const info = typeof image === 'string' ? sniff(image) : null;
    if (info) return { image, mime: info.mime };
    return { error: '沒有畫出圖，再試一次' };
  }
  const code = String((body && body.error && body.error.code) || '');
  console.error('OpenAI 回', res.status, code);
  if (/insufficient_quota|billing/.test(code)) return { error: '這個月的畫圖預算用完了' };
  if (/moderation|content_policy/.test(code)) return { error: '這張被擋下來沒有畫，換一張再試' };
  if (res.status === 401 || res.status === 403) return { error: '雲端畫圖的設定有問題，暫時不能用' };
  if (res.status === 429 || res.status >= 500) return { error: '畫圖的服務現在很忙，等一下再試', retry: true };
  return { error: '沒畫成，再試一次' };
}

// ---------- 讀東西 ----------
// 超過上限回 null
async function readText(stream) {
  if (!stream) return '';
  const dec = new TextDecoder();
  let size = 0;
  let out = '';
  for await (const part of stream) {
    size += part.byteLength;
    if (size > BODY_MAX) return null;
    out += dec.decode(part, { stream: true });
  }
  return out + dec.decode();
}

// 從 base64 認 PNG／JPEG 並量寬高，認不得回 null
export function sniff(b64) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) return null;
  const bytes = (from, len) => {
    const a = Math.floor(from / 3) * 4;
    const b = Math.ceil((from + len) / 3) * 4;
    let s = '';
    try {
      s = atob(b64.slice(a, b));
    } catch {
      return null;
    }
    const at = from - (a / 4) * 3;
    return s.length >= at + len ? Uint8Array.from(s.slice(at, at + len), (c) => c.charCodeAt(0)) : null;
  };
  const head = bytes(0, 33);
  if (!head) return null;
  const v = new DataView(head.buffer);
  if (v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) {
    return { mime: 'image/png', w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null;
  // JPEG 一段一段跳，找到記寬高的那一段
  for (let i = 2, n = 0; n < 200; n += 1) {
    const s = bytes(i, 9);
    if (!s || s[0] !== 0xff) return null;
    const m = s[1];
    if (m === 0xff) i += 1;
    else if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) i += 2;
    else if (m === 0xd9 || m === 0xda) return null;
    else if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { mime: 'image/jpeg', w: s[7] * 256 + s[8], h: s[5] * 256 + s[6] };
    } else {
      const len = s[2] * 256 + s[3];
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

// ---------- 門口 ----------
const ORIGIN = /^(http:\/\/(localhost|127\.0\.0\.1|([a-z0-9-]+\.)+localhost)(:\d{1,5})?|capacitor:\/\/localhost)$/i;

async function route(request, env) {
  const url = new URL(request.url);
  const token = request.headers.get('x-onion-token') || '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return fail(401, '少了裝置代號，重新開一次 app 再試');
  const device = await sha256(token);
  const method = request.method;

  if (url.pathname === '/ping' && method === 'GET') {
    const left = await env.QUOTA.getByName('main').left(device);
    return json({ ok: true, name: '雲端', kind: 'cloud', engine: 'openai', left });
  }
  if (url.pathname === '/paint' && method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (env.POST_LIMIT && !(await env.POST_LIMIT.limit({ key: ip })).success) return fail(429, '送太快了，等一分鐘再試');
    if (num(request.headers.get('content-length'), 0) > BODY_MAX) return fail(413, '圖太大了，最多 12MB');
    const id = crypto.randomUUID().replaceAll('-', '');
    // 這裡不拆 body：免費方案的 Worker 一次只有 10 毫秒的計算時間，拆大圖交給 Durable Object
    const headers = { 'x-job': id, 'x-device': device };
    return env.JOB.getByName(id).fetch('https://job/', { method: 'POST', headers, body: request.body });
  }
  const m = url.pathname.match(/^\/paint\/([0-9a-f]{32})(\/image)?$/);
  if (!m) return fail(404, '沒有這個功能');
  const job = env.JOB.getByName(m[1]);
  const gone = () => fail(404, '找不到這張圖，可能已經過了一天');
  if (method === 'GET' && !m[2]) {
    const s = await job.status(device);
    return s ? json(s) : gone();
  }
  if (method === 'GET') {
    const r = await job.image(device);
    if (!r) return gone();
    return r.wait ? fail(409, '還沒畫好') : json(r);
  }
  if (method === 'DELETE' && !m[2]) return (await job.remove(device)) ? json({ ok: true }) : gone();
  return fail(405, '不能這樣用');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    if (origin && !ORIGIN.test(origin)) return fail(403, '這個網頁不能用');
    let res;
    if (request.method === 'OPTIONS') {
      res = new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'X-Onion-Token, Content-Type',
          'Access-Control-Max-Age': '600',
        },
      });
    } else {
      try {
        res = await route(request, env);
      } catch (e) {
        console.error(e && e.stack ? e.stack : e);
        res = fail(500, '雲端那頭出錯了，等一下再試');
      }
    }
    if (!origin) return res;
    const out = new Response(res.body, res);
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Vary', 'Origin');
    return out;
  },
};
