// 洋蔥地圖 iOS 版：在 Limrun 雲端 iPhone 模擬器走一遍並截圖，存到 shots/（SHOTS=資料夾 可以換地方）。
// 準備：npm install（這個資料夾與專案根目錄）；~/.lim/config.yaml 要有 api-key；Limrun 帳號要有點數或訂閱。
// 用法：node test.mjs <onion-simulator-app.zip> [段落,段落…]
//   段落：base walk card paint seed dark relaunch，不寫就全跑。card 之後的段落要先有走路的資料，所以單跑時也會先走。
//   zip 從 GitHub Actions 的 artifact「onion-simulator-app」下載（gh run download <run id> -n onion-simulator-app）。
// 餵的軌跡全是假的（台北、台南的馬路上隨便走）；畫圖的電腦是這支腳本裡的假伺服器，原圖傳回去，不碰 ChatGPT 額度。
// 模擬器按分鐘計費：不管成功失敗，finally 都會刪掉這次開的那一台，並列出帳號下還開著的機器。
process.env.TZ = 'UTC'; // 模擬器的時區是 UTC，日期的鍵要跟它一樣
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Limrun, { Ios } from '@limrun/api';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..', '..');
const OUT = process.env.SHOTS || join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });

const home = process.env.USERPROFILE ?? process.env.HOME;
const cfg = readFileSync(join(home, '.lim', 'config.yaml'), 'utf8');
const apiKey = process.env.LIM_API_KEY ?? (cfg.match(/api-key:\s*(\S+)/) ?? [])[1];
if (!apiKey) { console.error('no api key in ~/.lim/config.yaml'); process.exit(2); }

const ZIP = process.argv[2];
if (!ZIP) { console.error('usage: node test.mjs <app.zip> [base,walk,card,paint,seed,dark,relaunch]'); process.exit(2); }
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const on = s => !ONLY || ONLY.has(s);
const BUNDLE = 'org.domyweb.onion', PORT = 57090;
const lim = new Limrun({ apiKey });
const t0 = Date.now();
const LOGF = join(OUT, 'run.log'); writeFileSync(LOGF, '');
const log = (...a) => { const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '); console.log(s); appendFileSync(LOGF, s + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); log(ok ? 'PASS' : 'FAIL', name, note); };

let inst = null, c = null, SCREEN = { w: 393, h: 852 }, bootAt = 0, server = null;
const SAFE = { t: 59, b: 34 };

// ---------- 看畫面 ----------
function flat(n, out = []) {
  if (Array.isArray(n)) { for (const x of n) flat(x, out); return out; }
  if (!n || typeof n !== 'object') return out;
  out.push(n);
  for (const ch of n.children ?? []) flat(ch, out);
  return out;
}
async function nodes() { try { return flat(await c.elementTree()); } catch (e) { log('tree failed', e?.message); return []; } }
const textOf = n => [n.AXLabel, n.AXValue, n.title].filter(Boolean).join(' ');
async function texts() { return (await nodes()).map(textOf).filter(Boolean); }
const at = n => n.frame ? '@' + [n.frame.x, n.frame.y].map(Math.round).join(',') + ',' + Math.round(n.frame.width) + 'x' + Math.round(n.frame.height) : '';
async function dump(name, max = 70) {
  const ns = await nodes();
  log('tree@' + name + ' (' + ns.length + '):', JSON.stringify(ns.filter(textOf).map(n => textOf(n).slice(0, 60) + at(n)).slice(0, max)));
  return ns;
}
async function shot(name) {
  try {
    const s = await c.screenshot({ format: 'jpeg', size: 'scaled' });
    writeFileSync(join(OUT, name + '.jpg'), Buffer.from(s.base64, 'base64'));
    log('shot', name, s.width + 'x' + s.height);
  } catch (e) { log('shot failed', name, e?.message); }
}
async function has(t) { return (await texts()).some(x => x.includes(t)); }
async function waitFor(t, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await has(t)) return true; await sleep(500); }
  return false;
}
async function find(label, { contains = false, last = false } = {}) {
  const all = (await nodes()).filter(x => x.frame && x.frame.width > 0 && (contains ? textOf(x).includes(label) : (x.AXLabel === label || x.title === label)));
  return (last ? all[all.length - 1] : all[0]) ?? null;
}
async function tapXY(x, y, why = '') { try { await c.tap(x, y); log('tap', Math.round(x) + ',' + Math.round(y), why); } catch (e) { log('tap FAILED', why, e?.message); } }
/** 找無障礙標籤、捲到看得見、點它的中心；找不到用 fallback 座標 */
async function tapLabel(label, { wait = 700, fallback = null, contains = false, last = false, bottom = 125, seek = false } = {}) { // seek：畫面外的東西不在樹裡，往下捲著找
  for (let i = 0; i < 6; i++) {
    const n = await find(label, { contains, last });
    if (!n) { if (!seek) break; await scrollDown(320); continue; }
    const y = n.frame.y + n.frame.height / 2, lim2 = SCREEN.h - bottom;
    if (y > SAFE.t + 4 && y < lim2) { await tapXY(n.frame.x + n.frame.width / 2, y, label); await sleep(wait); return true; }
    const d = y >= lim2 ? Math.min(320, y - lim2 + 120) : Math.max(-320, y - SAFE.t - 160);
    await (d > 0 ? scrollDown(d) : scrollUp(-d));
  }
  if (fallback) { await tapXY(fallback[0], fallback[1], label + '（座標）'); await sleep(wait); return true; }
  log('tap target not found', label);
  return false;
}
// 分頁列：寬 300、高 64、離底部安全區 12；四等分
const TABS = ['地圖', '足跡', '製圖', '設定'];
function tabXY(name) {
  const i = TABS.indexOf(name), w = Math.min(300, SCREEN.w - 40), x0 = (SCREEN.w - w) / 2 + 6, cw = (w - 12) / 4;
  return [x0 + cw * (i + 0.5), SCREEN.h - SAFE.b - 12 - 32];
}
async function goTab(name) { await tapXY(...tabXY(name), '分頁 ' + name); await sleep(900); }
async function drag(x1, y1, x2, y2, steps = 8, hold = 120) {
  const acts = [{ type: 'touchDown', x: x1, y: y1 }];
  for (let i = 1; i <= steps; i++) { acts.push({ type: 'wait', durationMs: 1 }); acts.push({ type: 'touchMove', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }); }
  acts.push({ type: 'wait', durationMs: hold }, { type: 'touchUp', x: x2, y: y2 });
  try { await c.performActions(acts); } catch (e) { log('drag FAILED', e?.message); }
  await sleep(500);
}
// 捲動用 SDK 的 scroll：自己拖太快會被當成點一下，點到列上
async function scrollBy(dir, d) { try { await c.scroll(dir, d, { coordinate: [SCREEN.w / 2, dir === 'down' ? SCREEN.h * 0.72 : SCREEN.h * 0.36] }); } catch (e) { log('scroll FAILED', e?.message); } await sleep(500); }
const scrollDown = (d = 420) => scrollBy('down', d), scrollUp = (d = 420) => scrollBy('up', d);
async function press(x, y, ms) { try { await c.performActions([{ type: 'touchDown', x, y }, { type: 'wait', durationMs: ms }, { type: 'touchUp', x, y }]); } catch (e) { log('press FAILED', e?.message); } await sleep(700); }
async function button(b) { try { await c.performActions([{ type: 'buttonDown', button: b }, { type: 'wait', durationMs: 80 }, { type: 'buttonUp', button: b }]); log('button', b); } catch (e) { log('button FAILED', b, e?.message); } await sleep(1200); }
async function simctl(args, { timeout = 15000 } = {}) {
  try {
    const ex = c.simctl(args), r = await Promise.race([ex.wait(), sleep(timeout).then(() => 'timeout')]);
    log('simctl', args.slice(0, 4).join(' '), typeof r === 'string' ? r : 'code ' + r.code + ' ' + String(r.stderr || '').trim().slice(0, 120));
    return r;
  } catch (e) { log('simctl FAILED', args.join(' '), (e?.message ?? String(e)).slice(0, 200)); return null; }
}
async function allowIfAsked() {
  for (const l of ['Allow While Using App', 'Allow Once', '使用 App 期間允許', 'Change to Always Allow', 'Allow', '允許', 'OK']) {
    const n = await find(l);
    if (n) { await tapXY(n.frame.x + n.frame.width / 2, n.frame.y + n.frame.height / 2, '系統視窗 ' + l); await sleep(1200); return l; }
  }
  return null;
}
async function launch(fresh) { try { await c.launchApp(BUNDLE, fresh ? 'RelaunchIfRunning' : 'ForegroundIfRunning'); } catch (e) { log('launch failed', e?.message); await simctl(['launch', 'booted', BUNDLE]); } await sleep(fresh ? 5500 : 2000); }

// ---------- 手機裡的檔 ----------
const DATA = { bundleId: BUNDLE, containerType: 'data' };
async function pull(p) { try { return (await c.pullFile('Documents/' + p, DATA)); } catch (e) { return null; } }
async function pullJSON(p) { const b = await pull(p); try { return b && JSON.parse(b.toString('utf8')); } catch (e) { return null; } }
async function ls(p) { try { return (await c.listFiles('Documents/' + p, DATA)).filter(f => !f.isDirectory).map(f => f.name); } catch (e) { return []; } }
const TMP = mkdtempSync(join(tmpdir(), 'onion-limrun-'));
async function push(p, text) { const f = join(TMP, 'f.json'); writeFileSync(f, text); await c.pushFile(f, 'Documents/' + p, DATA); }
const dataUrl = s => Buffer.from(String(s).split(',')[1] ?? '', 'base64');

// ---------- 假資料：另外幾十天（台南），加上昨天在台北走一趟、兩次停留 ----------
function makeEngine() {
  const require = createRequire(join(REPO, 'package.json')), h3 = require('h3-js');
  const src = readFileSync(join(REPO, 'src/js/00-engine.js'), 'utf8'), a = src.indexOf('/*ENGINE_START*/'), b = src.indexOf('/*ENGINE_END*/');
  const mk = new Function('h3', src.slice(a, b) + '\nreturn { createEngine, dayKey };');
  const { createEngine, dayKey } = mk(h3);
  return { make: () => createEngine(h3), dayKey };
}
let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
function walkPts(sec, path, { stay = {}, mps = 1.3, step = 18 } = {}) { // path：[[lat,lng]…]，stay：{第幾個轉折點: 分鐘}
  const out = []; let t = sec;
  const add = (la, ln) => out.push([Math.round(t), +(la + (R() - 0.5) * 0.00005).toFixed(6), +(ln + (R() - 0.5) * 0.00005).toFixed(6), 8, 'w']);
  for (let i = 0; i < path.length; i++) {
    const [la, ln] = path[i];
    if (stay[i]) for (let m = 0; m <= stay[i]; m++) { add(la, ln); t += 60; } else add(la, ln);
    if (i + 1 === path.length) break;
    const [lb, lo] = path[i + 1], d = Math.hypot((lb - la) * 111000, (lo - ln) * 111000 * Math.cos(la * Math.PI / 180)), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k < n; k++) { t += d / n / mps; add(la + (lb - la) * k / n, ln + (lo - ln) * k / n); }
    t += d / n / mps;
  }
  return out;
}
async function seed() {
  const { make, dayKey } = makeEngine(), e = make();
  const meta = await pullJSON('onion/meta.json'); if (meta) e.loadMeta(meta);
  for (const f of await ls('onion/cells')) if (f.endsWith('.json')) { const o = await pullJSON('onion/cells/' + f); if (o) e.loadCells(o); }
  const midnight = Math.floor(Date.now() / 864e5) * 86400, days = {}, o = make();
  const days40 = [300, ...Array.from({ length: 42 }, (_, i) => 43 - i)]; // 最早一筆在去年
  for (const back of days40) {
    if (back === 1 || R() < 0.12) continue;
    let la = 22.99 + R() * 0.02, ln = 120.195 + R() * 0.02; const path = [[la, ln]];
    for (let i = 0; i < 6; i++) { if (i % 2) la += (R() < 0.5 ? -1 : 1) * (0.002 + R() * 0.004); else ln += (R() < 0.5 ? -1 : 1) * (0.002 + R() * 0.004); path.push([la, ln]); }
    const pts = walkPts(midnight - back * 86400 + 7200 + R() * 20000, path); days[dayKey(pts[0][0])] = pts;
  }
  const y = walkPts(midnight - 86400 + 2 * 3600, [[25.0478, 121.5170], [25.0443, 121.5196], [25.0441, 121.5292], [25.0415, 121.5330], [25.0330, 121.5352], [25.0297, 121.5357], [25.0262, 121.5434], [25.0330, 121.5437], [25.0333, 121.5640]], { stay: { 2: 18, 5: 32 } });
  days[dayKey(y[0][0])] = y;
  for (const k of Object.keys(days).sort()) { o.resetLast(); for (const p of days[k]) o.process({ lat: p[1], lng: p[2], acc: p[3], t: p[0] * 1000, spd: 1.3 }); }
  e.merge(o.state(), days);
  const r = e.takeSaves(); let n = 0;
  for (const k in days) { await push('onion/days/' + k + '.json', JSON.stringify(days[k])); n++; }
  for (const k of r.shards) await push('onion/cells/' + k + '.json', JSON.stringify(e.shardData(k)));
  await push('onion/meta.json', JSON.stringify(e.meta()));
  log('seeded', n, 'days,', r.shards.length, 'shards,', Object.keys(e.state().cells).length, 'cells');
  return { yesterday: dayKey(y[0][0]), n };
}

// ---------- 假的畫圖電腦：原圖傳回去（介面照 docs/模組約定.md） ----------
const TOKEN = 'limrun-test'; const paints = [];
function startPainter(delay) {
  const jobs = new Map(); let n = 0;
  return new Promise(ok => {
    const s = createServer((q, a) => {
      const send = (code, o) => { a.writeHead(code, { 'Content-Type': 'application/json' }); a.end(JSON.stringify(o)); };
      if (q.headers['x-onion-token'] !== TOKEN) return send(401, { error: '密碼不對' });
      const m = /^\/paint\/([^/]+)(\/image)?$/.exec(q.url), j = m && jobs.get(m[1]);
      if (q.url === '/ping') return send(200, { ok: true, name: '測試電腦', kind: 'pc', engine: 'codex' });
      if (q.method === 'POST' && q.url === '/paint') {
        const bufs = []; q.on('data', b => bufs.push(b)); q.on('end', () => {
          const o = JSON.parse(Buffer.concat(bufs).toString('utf8')), id = 'j' + ++n, raw = Buffer.from(o.image, 'base64');
          writeFileSync(join(OUT, 'sent-' + o.kind + '-' + n + '.jpg'), raw); paints.push({ kind: o.kind, bytes: raw.length }); log('painter got', o.kind, raw.length, 'bytes');
          jobs.set(id, { at: Date.now(), image: o.image, mime: raw[0] === 0xff ? 'image/jpeg' : 'image/png' }); send(202, { id });
        }); return;
      }
      if (!j) return send(404, { error: '找不到' });
      if (q.method === 'DELETE') { jobs.delete(m[1]); return send(200, { ok: true }); }
      const done = Date.now() - j.at > delay;
      if (m[2]) return done ? send(200, { image: j.image, mime: j.mime }) : send(409, { error: '還沒好' });
      send(200, { status: done ? 'done' : 'painting', ahead: 0, seconds: Math.round((Date.now() - j.at) / 1000) });
    });
    s.listen(PORT, '127.0.0.1', () => ok(s));
  });
}

// ---------- 段落 ----------
let walkAt = 0;
const WALK = ['25.0330,121.5654', '25.0375,121.5637', '25.0411,121.5578', '25.0414,121.5445', '25.0330,121.5434'], WALK_SEC = Number(process.env.WALK_SEC) || 345; // 時速 23.4 公里走 345 秒，約 2.2 公里
const recFallback = () => [SCREEN.w - 20 - 12 - 32, SCREEN.h - SAFE.b - 92 - 44];

async function sBase() {
  const ns = await dump('launch');
  await shot('01-map-launch');
  check('開啟後看得到分頁列四頁', TABS.every(t => ns.some(n => textOf(n).includes(t))));
  check('地圖頁有記錄鈕', ns.some(n => textOf(n).includes('開始記錄')));
  await tapLabel('圖例', { wait: 1200, fallback: [SCREEN.w - 20 - 22, SAFE.t + 8 + 22] });
  await shot('02-legend'); check('圖例抽屜打開', await has('沒去過'));
  await tapLabel('關閉', { bottom: 20 });
  await goTab('足跡'); await shot('03-steps-empty'); check('足跡空狀態', await has('還沒有足跡'));
  await goTab('製圖'); await shot('04-card-empty'); check('製圖空狀態', await has('還沒走過任何地方'));
  await goTab('設定'); await shot('05-settings-top');
  const st = await texts(), T = t => st.some(x => x.includes(t));
  check('設定頁：匯出備份、定位權限', T('匯出備份') && T('定位權限'));
  check('設定頁：正式版藏模擬模式', !T('模擬模式'));
  await scrollDown(); await scrollDown(); await shot('06-settings-mid');
  const st2 = [...st, ...await texts()], T2 = t => st2.some(x => x.includes(t)); check('設定頁三塊：匯入、離線、畫圖', T2('匯入足跡或備份') && T2('離線地圖') && T2('用電腦的 ChatGPT 畫'));
  await scrollDown(600); await scrollDown(600); await shot('07-settings-bottom');
  check('設定頁捲到底看得到清除紀錄', await has('清除全部紀錄'));
  await goTab('地圖');
}

async function sWalkStart() {
  await goTab('地圖');
  await simctl(['location', 'booted', 'set', WALK[0]]);
  await tapLabel('開始記錄', { wait: 1500, fallback: recFallback(), bottom: 20 });
  const a = await allowIfAsked(); if (a) log('permission', a);
  c.simctl(['location', 'booted', 'start', '--speed=6.5', '--distance=10', ...WALK]); walkAt = Date.now();
  await sleep(6000);
  const a2 = await allowIfAsked(); if (a2) log('permission (late)', a2);
  await sleep(3000); await shot('10-recording');
}

async function sWalkMeanwhile(full) { // 邊走邊看別的，走路的時間不浪費
  const rt = await texts();
  check('記錄中：標題換成「記錄中」', rt.some(x => x.includes('記錄中')));
  if (!full) return;
  // 拖走再定位
  await drag(SCREEN.w / 2, SCREEN.h * 0.4, SCREEN.w / 2 - 150, SCREEN.h * 0.4 + 180);
  await tapLabel('回到我的位置', { wait: 3000, fallback: [SCREEN.w - 42, SAFE.t + 86] });
  await shot('11-located');
  // 即時動態：回主畫面看動態島、按住展開、鎖定畫面
  await button('home'); await sleep(1800); await shot('12-island-compact');
  await press(SCREEN.w / 2, 30, 1200); await shot('13-island-expanded'); await sleep(1500); await shot('13b-island-expanded');
  await tapXY(SCREEN.w / 2, SCREEN.h * 0.75, '收起動態島'); await sleep(800);
  await button('lock'); await sleep(1500); await button('lock'); await sleep(2500); await shot('14-lockscreen');
  const al = await allowIfAsked(); if (al) { log('lock screen alert', al); await shot('14b-lockscreen'); }
  await button('home'); await sleep(800);
  await drag(SCREEN.w / 2, SCREEN.h - 6, SCREEN.w / 2, SCREEN.h * 0.3, 6, 10); await sleep(1500);
  await launch(); await sleep(1500); await shot('15-back-from-lock');
  check('鎖定、背景回來還在記錄', await has('停止記錄'), (await texts()).find(x => /km\/h/.test(x)) ?? '');
  // 設定頁的抽屜
  await goTab('設定');
  if (await tapLabel('匯入足跡或備份', { contains: true, wait: 1200 })) { await shot('16-import-sheet'); check('匯入抽屜打開', await has('Google 時間軸')); await dump('import-sheet', 30); await tapLabel('先不要', { bottom: 20 }); check('匯入抽屜關掉', !await has('選檔案')); }
  if (await tapLabel('用電腦的 ChatGPT 畫', { contains: true, wait: 1200 })) { await shot('17-pair-sheet'); check('配對抽屜打開', await has('掃 QR')); await tapLabel('先不要', { bottom: 20 }); check('配對抽屜關掉', !await has('掃 QR')); }
  if (await tapLabel('把這一帶畫成手繪地圖', { contains: true, wait: 1500 })) { await shot('18-base-sheet'); check('手繪地圖抽屜打開', await has('12 公里寬')); await tapLabel('關閉', { bottom: 20 }); }
  await tapLabel('占用空間', { contains: true, wait: 600, seek: true }); await shot('19-offline');
  const of = await texts(); check('離線地圖認得出縣市', of.some(x => /臺北市|台北市/.test(x)), of.find(x => /MB/.test(x)) ?? '');
  // 長按取名
  await goTab('地圖'); await tapLabel('回到我的位置', { wait: 2500, fallback: [SCREEN.w - 42, SAFE.t + 86] });
  await press(SCREEN.w * 0.35, SCREEN.h * 0.42, 900); await sleep(900); await shot('20-place-sheet');
  if (await has('這裡叫什麼')) {
    check('長按地圖跳出取名', true); check('長按放開沒有誤按到建議的名字', !(await texts()).some(x => /^名字 (?!名字)/.test(x)), (await texts()).find(x => x.startsWith('名字')) ?? ''); await dump('place-sheet', 30);
    const nm = await find('名字', { contains: true });
    if (nm) { await tapXY(nm.frame.x + 60, nm.frame.y + nm.frame.height / 2, '名字欄'); await sleep(1500); await shot('21-place-keyboard'); await c.typeText('Park', true).catch(() => {}); await sleep(1200); await shot('22-place-typed'); }
    const chip = await find('存好'); if (chip) { await tapLabel('存好', { bottom: 20, wait: 1500 }); } else await tapLabel('先不要', { bottom: 20 });
    await shot('23-place-saved');
  } else check('長按地圖跳出取名', false);
}

async function sWalkEnd() {
  const left = WALK_SEC - (Date.now() - walkAt) / 1000; if (left > 0) { log('走完還要', Math.round(left), '秒'); while ((Date.now() - walkAt) / 1000 < WALK_SEC) { c.keepAlive?.(); await sleep(Math.min(20000, Math.max(500, WALK_SEC * 1000 - (Date.now() - walkAt)))); await has('x'); } }
  await goTab('地圖'); await shot('25-walk-end');
  await tapLabel('停止記錄', { wait: 1500, fallback: recFallback(), bottom: 20 });
  await simctl(['location', 'booted', 'clear']);
  await shot('26-rec-stopped');
  const stats = (await texts()).find(x => /km²/.test(x)) ?? '';
  check('停止後統計不是 0', /km²/.test(stats) && !/^0\.000/.test(stats.trim()), stats);
  const days = await ls('onion/days'); check('今天的軌跡存進檔案', days.some(d => /^\d{4}-\d\d-\d\d\.json$/.test(d)), days.join(' '));
}

async function cardReady(ms = 60000) { // 等日卡準備好，回傳秒數
  const s = Date.now();
  while (Date.now() - s < ms) { const t = await texts(); if (t.some(x => /請 ChatGPT 畫這一天|再畫一次|再試一次|這天走得太近/.test(x))) return [(Date.now() - s) / 1000, t]; await sleep(300); }
  return [-1, await texts()];
}
let todayKey = '';
async function sCard() {
  await goTab('足跡'); await sleep(800); await shot('30-steps');
  const s5 = await texts();
  check('足跡有今天這一列', s5.some(x => /週[日一二三四五六]/.test(x)), s5.find(x => /週/.test(x)) ?? '');
  check('足跡有稱號與印章', s5.some(x => x.includes('稱號')) && s5.some(x => x.includes('印章')));
  const st = s5.find(x => x.startsWith('印章：'));
  if (st && await tapLabel(st, { wait: 1200 })) { await shot('31-stamp-sheet'); check('印章抽屜', await has('看在哪裡') || await has('關閉')); await tapLabel('關閉', { bottom: 20 }); } else log('沒有印章可以點');
  await tapXY(...tabXY('製圖'), '分頁 製圖'); const s = Date.now();
  await sleep(250); await shot('32-card-waiting');
  const [sec, t] = await cardReady(); log('日卡準備', sec.toFixed(1), '秒（含點下去的 ' + ((Date.now() - s) / 1000).toFixed(1) + '）');
  check('日卡準備好', t.some(x => x.includes('請 ChatGPT 畫這一天')), sec.toFixed(1) + ' 秒 ' + (t.find(x => /載不下來|走得太近/.test(x)) ?? ''));
  await sleep(1500); await shot('33-card-day'); await dump('card-day', 40);
  const f = (await ls('onion/cards')).find(x => /^\d{4}.*\.json$/.test(x)); todayKey = f ? f.slice(0, -5) : '';
  const rec = f && await pullJSON('onion/cards/' + f);
  if (rec) { writeFileSync(join(OUT, 'draft-today.jpg'), dataUrl(rec.draft)); writeFileSync(join(OUT, 'ref-today.png'), dataUrl(rec.ref)); log('facts', JSON.stringify({ city: rec.facts.city, town: rec.facts.town, stats: rec.facts.stats, marks: rec.facts.marks?.length, places: rec.facts.places?.length, stops: rec.facts.stops?.length, lines: rec.facts.lines?.map(l => l.length) })); }
  check('底稿存得到、不是空的（離屏 WebGL）', rec && dataUrl(rec.draft).length > 80000, rec ? dataUrl(rec.draft).length + ' bytes' : '沒有檔');
  for (const n of ['花卉卷軸', '花藤環繞', '城堡', '水彩花藤']) { await tapLabel('換成' + n + '框', { wait: 2600, seek: true }); await shot('34-frame-' + n); }
  // 走過的地方
  await scrollUp(600);
  await tapLabel('走過的地方', { wait: 3500 }); await shot('35-card-all'); await scrollDown(); await shot('36-card-all-bottom');
  check('走過的地方有分享鈕', await has('分享這張'));
  await scrollUp(700); await tapLabel('一天', { wait: 1500 }); check('切回一天', await has('請 ChatGPT 畫這一天'));
}

async function sPaint() {
  server = await startPainter(9000);
  const tun = await c.startReverseTunnel({ remotePort: PORT }).catch(e => { log('tunnel failed', e?.message); return null; });
  if (!tun) { check('反向通道', false); return; }
  log('tunnel', JSON.stringify(tun.remoteAddress));
  await c.openUrl('onion://pair?u=' + encodeURIComponent('http://' + tun.remoteAddress.address + ':' + tun.remoteAddress.port) + '&t=' + TOKEN + '&n=' + encodeURIComponent('測試電腦')); await sleep(2500);
  for (const l of ['Open', '打開']) { const n = await find(l); if (n) { await tapXY(n.frame.x + n.frame.width / 2, n.frame.y + n.frame.height / 2, l); await sleep(1500); } }
  await shot('40-pair-confirm'); check('掃碼連結開出確認抽屜', await has('幫你畫圖'));
  await tapLabel('好，用這台', { wait: 2500, bottom: 20 }); await shot('41-paired');
  check('配對成功', !await has('幫你畫圖'));
  await goTab('製圖'); await cardReady(30000);
  await tapLabel('請 ChatGPT 畫這一天', { wait: 1200 }); await shot('42-paint-ask');
  await tapLabel('開始畫', { wait: 2500, bottom: 20 }); await shot('43-painting');
  check('畫的時候有寫在等', await has('ChatGPT 正在畫') || await has('正在送出'));
  const ok = await waitFor('再畫一次', 60000); await sleep(1500); await shot('44-painted');
  check('畫好收得回來', ok && paints.some(p => p.kind === 'day'));
  await tapLabel('IG 4:5', { wait: 2500 }); await shot('45-card-4x5');
  for (const n of ['花卉卷軸', '花藤環繞', '城堡', '水彩花藤']) { await tapLabel('換成' + n + '框', { wait: 2400, seek: true }); await shot('46-4x5-' + n); }
  await scrollUp(600); await tapLabel('分享', { wait: 4000 }); await shot('47-share'); await dump('share', 40);
  const ss = await texts(); check('分享面板開得出來', ss.some(x => /Save Image|儲存影像|Copy|拷貝|onion-/.test(x)));
  const cl = await find('Close') ?? await find('關閉'); if (cl) await tapXY(cl.frame.x + cl.frame.width / 2, cl.frame.y + cl.frame.height / 2, '關分享'); else await drag(SCREEN.w / 2, SCREEN.h * 0.55, SCREEN.w / 2, SCREEN.h - 10);
  await sleep(1500); await shot('48-after-share');
  await goTab('設定'); await tapLabel('用電腦的 ChatGPT 畫', { contains: true, wait: 2500 }); await shot('49-paired-sheet'); check('配對後抽屜寫連得到', await has('連得到')); await tapLabel('關閉', { bottom: 20 });
  // 把這一帶畫成手繪地圖
  if (await tapLabel('把這一帶畫成手繪地圖', { contains: true, wait: 1500 })) { await tapLabel('畫這一帶', { wait: 1000, bottom: 20 }); const s = Date.now(); while (Date.now() - s < 45000 && !paints.some(p => p.kind === 'base')) await sleep(1000); check('底圖底稿送得出去', paints.some(p => p.kind === 'base'), ((Date.now() - s) / 1000).toFixed(0) + ' 秒'); await waitFor('1 張', 40000); await shot('50-base-done'); await goTab('地圖'); await sleep(2500); await shot('51-base-on-map'); }
}

let yesterday = '';
async function sSeed() {
  await goTab('地圖'); await sleep(1500);
  try { await c.terminateApp(BUNDLE); } catch (e) { log('terminate failed', e?.message); } await sleep(1000);
  const r = await seed(); yesterday = r.yesterday;
  await launch(true); await sleep(2500); await shot('60-ask-card');
  const asked = await has('要幫它取名嗎'); check('停留點提問卡跳出來', asked); await dump('ask', 40);
  if (asked) { await sleep(3500); await shot('61-ask-chips'); await tapLabel('跳過', { wait: 2000, bottom: 20 }); await shot('62-ask-skipped'); check('跳過後卡片收起來', !await has('要幫它取名嗎')); }
  await goTab('足跡'); await sleep(1500); await shot('63-steps-many'); await scrollDown(); await shot('64-steps-mid'); await scrollDown(700); await scrollDown(700); await shot('65-steps-list');
  await goTab('製圖'); const [sec] = await cardReady(); check('塞資料後今天的卡還在（不用重準備）', sec >= 0 && sec < 6, sec.toFixed(1) + ' 秒'); await sleep(1200); await shot('66-card-today-again');
  await tapLabel('選一天', { wait: 1200 }); await shot('67-choose-top'); await dump('choose', 12);
  for (let i = 0; i < 6; i++) await scrollDown(560);
  await sleep(800); await shot('68-choose-bottom');
  const cb = await find('關閉', { last: true });
  check('選一天捲得到底、關閉鈕高度正常', cb && cb.frame.height >= 44 && cb.frame.height <= 64 && cb.frame.y + cb.frame.height <= SCREEN.h - SAFE.b + 2, cb ? at(cb) : '找不到關閉');
  await tapLabel('關閉', { last: true, bottom: 20 }); check('選一天關得掉', !await has('現在這天'));
  await tapLabel('選一天', { wait: 1200 }); await tapXY(SCREEN.w / 2, 277, '抽屜第二列：昨天'); await sleep(250); const [s2, t2] = await cardReady(); await sleep(1800); await shot('69-card-yesterday');
  check('昨天的卡（有停留點）畫得出來', t2.some(x => x.includes('請 ChatGPT 畫這一天')), s2.toFixed(1) + ' 秒');
  const ry = await pullJSON('onion/cards/' + yesterday + '.json'); if (ry) { writeFileSync(join(OUT, 'draft-yesterday.jpg'), dataUrl(ry.draft)); log('yesterday facts', JSON.stringify({ city: ry.facts.city, town: ry.facts.town, stats: ry.facts.stats, stops: ry.facts.stops.map(s => [s.name, s.minutes]), marks: ry.facts.marks.map(m => m.name), places: ry.facts.places.map(m => m.name) })); }
  await tapLabel('前一天', { wait: 400 }); const [s3] = await cardReady(); await sleep(1800); await shot('70-card-tainan'); log('台南那天', s3.toFixed(1), '秒');
}

async function sDark() {
  await simctl(['ui', 'booted', 'appearance', 'dark']); await sleep(1800);
  await goTab('製圖'); await sleep(1500); await shot('80-dark-card');
  await goTab('足跡'); await sleep(600); await shot('81-dark-steps');
  await goTab('設定'); await sleep(600); await shot('82-dark-settings');
  if (await tapLabel('匯入足跡或備份', { contains: true, wait: 1200 })) { await shot('83-dark-sheet'); await tapLabel('先不要', { bottom: 20 }); }
  await goTab('地圖'); await sleep(1500); await shot('84-dark-map');
  await simctl(['ui', 'booted', 'appearance', 'light']); await sleep(800);
}

async function sRelaunch() {
  await goTab('地圖'); const before = (await texts()).find(x => /km²/.test(x)) ?? '';
  await button('home'); await sleep(4000); await launch(); await sleep(1000);
  check('背景再回來資料還在', (await texts()).some(x => /km²/.test(x) && !/^0\.000/.test(x.trim()))); await shot('90-back');
  try { await c.terminateApp(BUNDLE); } catch (e) { log('terminate failed', e?.message); } await sleep(1000);
  await launch(true); await shot('91-relaunch');
  const again = (await texts()).find(x => /km²/.test(x)) ?? '';
  check('重開後紀錄還在', /km²/.test(again) && !/^0\.000/.test(again.trim()), before.slice(0, 40) + ' → ' + again.slice(0, 40));
  await goTab('製圖'); const [sec, t] = await cardReady(); await sleep(1500); await shot('92-relaunch-card');
  check('重開後日卡還在', sec >= 0 && sec < 6, sec.toFixed(1) + ' 秒 ' + (t.some(x => x.includes('再畫一次')) ? '（畫好的那張）' : ''));
}

const appLines = []; let stream = null, sys = null, guard = null;
try {
  log('uploading', ZIP);
  const asset = await lim.assets.getOrUpload({ path: ZIP, name: 'onion-sim-' + Date.now() + '.zip', platform: 'ios', kind: 'App', ttl: '2h' });
  log('asset', asset.name);

  log('creating instance');
  // 帳號同時能開的台數有上限（5 台）；別的專案占著就排隊，每 40 秒試一次，最多等 20 分鐘
  for (let tries = 0; ; tries++) {
    try {
      inst = await lim.iosInstances.create({
        wait: true,
        metadata: { displayName: 'onion-map-ui-test', labels: { project: 'onion-map' } },
        spec: {
          model: 'iphone',
          inactivityTimeout: '3m',
          hardTimeout: '22m',
          initialAssets: [{ kind: 'App', source: 'AssetName', assetName: asset.name, launchMode: 'RelaunchIfRunning' }],
        },
      });
      break;
    } catch (e) {
      if (!/concurrency/i.test(e?.message ?? '') || tries >= 30) throw e;
      if (tries % 3 === 0) log('排隊中：帳號的台數滿了，40 秒後再試（第 ' + (tries + 1) + ' 次）');
      await sleep(40000);
    }
  }
  bootAt = Date.now();
  log('instance', inst.metadata?.id, inst.status?.state);
  c = await Ios.createInstanceClient({ apiUrl: inst.status.apiUrl, token: inst.status.token, logLevel: 'none' });
  log('connected');
  try { await c.startAppLogCapture({ bundleId: BUNDLE }); stream = c.streamAppLogCapture({ onLine: l => appLines.push(l.line), onError: () => {} }); } catch (e) { log('log capture failed', e?.message); }
  try { sys = c.streamSyslog(); sys.on('line', l => { if (/⚡️|WebContent|\bApp\[|\bApp:|洋蔥|org\.domyweb|jetsam|OnionWidget/i.test(l)) appendFileSync(join(OUT, 'syslog.log'), l + '\n'); }); sys.on('error', () => {}); } catch (e) { log('syslog failed', e?.message); }
  try { await c.monitorApp(BUNDLE, { onExit: i => log('APP EXIT', JSON.stringify(i).slice(0, 300)), onHang: i => log('HANG', JSON.stringify(i).slice(0, 200)) }); } catch (e) { log('monitor failed', e?.message); }
  guard = setTimeout(() => { log('TIMEOUT 20 分鐘，收掉'); lim.iosInstances.delete(inst.metadata.id).finally(() => process.exit(3)); }, 20 * 60e3);
  // 先給定位權限、放好位置，免得第一次記錄被系統視窗擋住
  await simctl(['privacy', 'booted', 'grant', 'location-always', BUNDLE]);
  await simctl(['location', 'booted', 'set', WALK[0]]);
  await launch(true);
  let ns = await nodes();
  const root = ns.find(n => n.frame && n.frame.width > 300 && n.frame.height > 600);
  if (root) { SCREEN = { w: root.frame.width, h: root.frame.height }; }
  log('screen', JSON.stringify(SCREEN));
  await sleep(2500); // 等圖磚

  const part = async (name, fn) => { try { log('==== ' + name); await fn(); } catch (e) { log('段落出錯', name, e?.stack ?? e); check('段落 ' + name + ' 跑完', false, e?.message ?? String(e)); } };
  if (on('base')) await part('base', sBase);
  await part('walk', async () => { await sWalkStart(); await sWalkMeanwhile(on('walk')); await sWalkEnd(); });
  if (on('card')) await part('card', sCard);
  if (on('paint')) await part('paint', sPaint);
  if (on('seed')) await part('seed', sSeed);
  if (on('dark')) await part('dark', sDark);
  if (on('relaunch')) await part('relaunch', sRelaunch);
  log('DONE');
} catch (e) {
  log('ERROR', e?.message ?? String(e));
  if (e?.status) log('http', e.status, JSON.stringify(e.error ?? e.body ?? e.cause ?? '').slice(0, 500));
  process.exitCode = 1;
} finally {
  clearTimeout(guard);
  if (c) { try { const tail = await Promise.race([c.appLogTail(BUNDLE, 2000), sleep(8000).then(() => '')]); if (tail) writeFileSync(join(OUT, 'app-tail.log'), tail); } catch (e) { log('tail failed', e?.message); } }
  writeFileSync(join(OUT, 'app.log'), appLines.join('\n'));
  try { stream && stream(); sys && sys.stop(); } catch {}
  if (c) { try { c.disconnect(); } catch {} }
  if (inst?.metadata?.id) {
    for (let i = 0; i < 3; i++) {
      try { await lim.iosInstances.delete(inst.metadata.id); log('instance deleted', inst.metadata.id, '開了', ((Date.now() - bootAt) / 60000).toFixed(1), '分鐘'); break; }
      catch (e) { log('DELETE FAILED', inst.metadata.id, e?.message); await sleep(2000); }
    }
  }
  if (server) server.close();
  rmSync(TMP, { recursive: true, force: true });
  try { // 確認帳號下沒有這個專案開著的機器（別的專案的不動）。剛刪的那台會有幾秒還顯示 ready
    await sleep(5000); const left = [];
    for await (const i of lim.iosInstances.list()) if (i.status?.state !== 'terminated') left.push((i.metadata?.id ?? '?') + ' ' + (i.status?.state ?? '') + ' ' + JSON.stringify(i.metadata?.labels ?? {}) + (i.metadata?.id === inst?.metadata?.id ? '（這次開的，正在關）' : ''));
    log('還開著的機器：' + (left.length ? left.join(' | ') : '沒有'));
  } catch (e) { log('list failed', e?.message); }
  const bad = appLines.filter(l => /\[error\]|\[warn\]|JS Eval|Unhandled|TypeError|ReferenceError|ERROR MESSAGE/i.test(l));
  log('app 的錯誤與警告 ' + bad.length + ' 行'); for (const l of [...new Set(bad)].slice(0, 30)) log('  ', l.slice(0, 300));
  const fails = results.filter(r => !r.ok);
  log('結果：' + (results.length - fails.length) + ' 過，' + fails.length + ' 沒過');
  for (const r of fails) log('  FAIL', r.name, r.note);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  log('total', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  process.exit(process.exitCode ?? 0);
}
