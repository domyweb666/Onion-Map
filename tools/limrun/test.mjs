// 洋蔥地圖 iOS 版：在 Limrun 雲端 iPhone 模擬器走一遍四個分頁並截圖，存到 shots/。
// 準備：npm install（這個資料夾）；~/.lim/config.yaml 要有 api-key；Limrun 帳號要有點數或訂閱。
// 用法：node test.mjs <onion-simulator-app.zip>
//   zip 從 GitHub Actions 的 artifact「onion-simulator-app」下載（gh run download <run id> -n onion-simulator-app）。
// 模擬器按分鐘計費：不管成功失敗，finally 都會刪掉這次開的那一台，並列出帳號下還開著的機器。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Limrun, { Ios } from '@limrun/api';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
mkdirSync(OUT, { recursive: true });

const home = process.env.USERPROFILE ?? process.env.HOME;
const cfg = readFileSync(join(home, '.lim', 'config.yaml'), 'utf8');
const apiKey = process.env.LIM_API_KEY ?? (cfg.match(/api-key:\s*(\S+)/) ?? [])[1];
if (!apiKey) { console.error('no api key in ~/.lim/config.yaml'); process.exit(2); }

const ZIP = process.argv[2];
if (!ZIP) { console.error('usage: node test.mjs <app.zip>'); process.exit(2); }
const BUNDLE = 'org.domyweb.onion';
const lim = new Limrun({ apiKey });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); log(ok ? 'PASS' : 'FAIL', name, note); };

let inst = null, c = null, SCREEN = { w: 393, h: 852 };

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
async function dump(name) {
  const ns = await nodes();
  const ls = ns.filter(n => textOf(n)).map(n => textOf(n) + (n.frame ? '@' + Math.round(n.frame.x) + ',' + Math.round(n.frame.y) + ',' + Math.round(n.frame.width) + 'x' + Math.round(n.frame.height) : ''));
  log('tree@' + name + ' (' + ns.length + ' nodes):', JSON.stringify(ls.slice(0, 70)));
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
  while (Date.now() < end) { if (await has(t)) return true; await sleep(700); }
  return false;
}
async function frameOf(label, { contains = false } = {}) {
  const n = (await nodes()).find(x => contains ? textOf(x).includes(label) : (x.AXLabel === label || x.title === label));
  return n?.frame ?? null;
}
async function tapXY(x, y, why = '') { try { await c.tap(x, y); log('tap', Math.round(x) + ',' + Math.round(y), why); } catch (e) { log('tap FAILED', why, e?.message); } }
/** 先用無障礙標籤點；WebView 裡找不到就點標籤的 frame 中心；再不行用 fallback 座標 */
async function tapLabel(label, { wait = 700, fallback = null, contains = false } = {}) {
  const f = await frameOf(label, { contains });
  if (f && f.width > 0) { await tapXY(f.x + f.width / 2, f.y + f.height / 2, label); await sleep(wait); return true; }
  if (fallback) { await tapXY(fallback[0], fallback[1], label + '（座標）'); await sleep(wait); return true; }
  log('tap target not found', label);
  return false;
}
// 分頁列：寬 300、高 64、離底部安全區 12；四等分
const TABS = ['地圖', '足跡', '製圖', '設定'];
function tabXY(name, safeB = 34) {
  const i = TABS.indexOf(name), w = Math.min(300, SCREEN.w - 40), x0 = (SCREEN.w - w) / 2 + 6, cw = (w - 12) / 4;
  return [x0 + cw * (i + 0.5), SCREEN.h - safeB - 12 - 32];
}
async function goTab(name) { await tapXY(...tabXY(name), '分頁 ' + name); await sleep(900); }
async function drag(x1, y1, x2, y2, steps = 6) {
  const acts = [{ type: 'touchDown', x: x1, y: y1 }];
  for (let i = 1; i <= steps; i++) { acts.push({ type: 'wait', durationMs: 1 }); acts.push({ type: 'touchMove', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }); }
  acts.push({ type: 'wait', durationMs: 60 }, { type: 'touchUp', x: x2, y: y2 });
  try { await c.performActions(acts); } catch (e) { log('drag FAILED', e?.message); }
  await sleep(700);
}
const scrollDown = (d = 420) => drag(SCREEN.w / 2, SCREEN.h * 0.62, SCREEN.w / 2, SCREEN.h * 0.62 - d);
async function simctl(args, { timeout = 15000 } = {}) {
  try {
    const ex = c.simctl(args);
    const r = await Promise.race([ex.wait ? ex.wait() : ex, sleep(timeout).then(() => 'timeout')]);
    log('simctl', args.slice(0, 4).join(' '), typeof r === 'string' ? r : JSON.stringify(r ?? '').slice(0, 160));
    return r;
  } catch (e) { log('simctl FAILED', args.join(' '), (e?.message ?? String(e)).slice(0, 200)); return null; }
}
async function allowIfAsked() {
  for (const l of ['Allow While Using App', 'Allow Once', '使用 App 期間允許', 'Allow', '允許', 'OK']) {
    const f = await frameOf(l);
    if (f) { await tapXY(f.x + f.width / 2, f.y + f.height / 2, '權限視窗 ' + l); await sleep(1200); return l; }
  }
  return null;
}

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
          hardTimeout: '12m',
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
  log('instance', inst.metadata?.id, inst.status?.state);
  c = await Ios.createInstanceClient({ apiUrl: inst.status.apiUrl, token: inst.status.token, logLevel: 'none' });
  log('connected');
  // 先給定位權限、放好位置，免得第一次記錄被系統視窗擋住
  await simctl(['privacy', 'booted', 'grant', 'location-always', BUNDLE]);
  await simctl(['location', 'booted', 'set', '25.0330,121.5654']);
  await sleep(3500);

  // ---------- 1. 開啟：地圖頁 ----------
  let ns = await dump('launch');
  if (!ns.some(n => textOf(n).includes('地圖'))) {
    log('app not in front, launching via simctl');
    await simctl(['launch', 'booted', BUNDLE]); await sleep(5000);
    ns = await dump('launch2');
  }
  const root = ns.find(n => n.frame && n.frame.width > 300 && n.frame.height > 600);
  if (root) { SCREEN = { w: root.frame.width, h: root.frame.height }; }
  log('screen', JSON.stringify(SCREEN));
  await sleep(2500); // 等圖磚
  await shot('01-map-launch');
  check('開啟後看得到分頁列四頁', TABS.every(t => ns.some(n => textOf(n).includes(t))));
  check('地圖頁有記錄鈕', ns.some(n => textOf(n).includes('開始記錄')));

  // ---------- 2. 三頁的空狀態 ----------
  await goTab('足跡'); await shot('02-steps-empty');
  check('足跡空狀態', await has('還沒有足跡'));
  await goTab('製圖'); await shot('03-card-empty');
  check('製圖空狀態', await has('還沒走過任何地方'));
  await goTab('設定'); await shot('04-settings-top');
  const st = await texts();
  check('設定頁：iOS 版寫「匯出備份」', st.some(x => x.includes('匯出備份')));
  check('設定頁：有定位權限列', st.some(x => x.includes('定位權限')));
  check('設定頁：正式版藏模擬模式', !st.some(x => x.includes('模擬模式')));
  await scrollDown(); await shot('05-settings-bottom');
  check('設定頁捲到底看得到清除紀錄', await has('清除全部紀錄'));

  // ---------- 3. 記錄一段路（模擬器餵定位） ----------
  await goTab('地圖');
  await tapLabel('開始記錄', { wait: 1500, fallback: [SCREEN.w - 20 - 12 - 32, SCREEN.h - 34 - 92 - 44] });
  const alert = await allowIfAsked(); if (alert) log('permission alert answered', alert);
  await shot('06-rec-started');
  // 每 10 公尺報一次、時速 18 公里（低於 25，算步行），往東北走
  c.simctl(['location', 'booted', 'start', '--speed=5', '--distance=10',
    '25.0330,121.5654', '25.0345,121.5668', '25.0352,121.5690', '25.0370,121.5700', '25.0385,121.5722']);
  await sleep(9000);
  const a2 = await allowIfAsked(); if (a2) log('permission alert answered (late)', a2);
  await tapLabel('回到我的位置', { wait: 3500, fallback: [SCREEN.w - 20 - 22, 59 + 8 + 44 + 12 + 22] });
  await sleep(14000);
  await shot('07-recording');
  await dump('recording');
  const rt = await texts();
  check('記錄中：狀態列有速度', rt.some(x => /km\/h/.test(x)), rt.find(x => /km\/h|定位|權限/.test(x)) ?? '');
  check('記錄中：標題換成「記錄中」', rt.some(x => x.includes('記錄中')));
  await sleep(14000);
  await shot('08-recording-later');
  await tapLabel('停止記錄', { wait: 1500, fallback: [SCREEN.w - 20 - 12 - 32, SCREEN.h - 34 - 92 - 44] });
  await simctl(['location', 'booted', 'clear']);
  await shot('09-rec-stopped');
  const stats = (await texts()).find(x => /km²/.test(x)) ?? '';
  check('停止後統計不是 0', /km²/.test(stats) && !/^0\.000/.test(stats.trim()), stats);

  // ---------- 4. 圖例 ----------
  await tapLabel('圖例', { wait: 1200, fallback: [SCREEN.w - 20 - 22, 59 + 8 + 22] });
  await shot('10-legend');
  check('圖例抽屜打開', await has('未探索'));
  await tapLabel('關閉', { wait: 800 });

  // ---------- 5. 足跡：有資料 ----------
  await goTab('足跡'); await sleep(600); await shot('11-steps');
  const s5 = await texts();
  check('足跡有今天這一列', s5.some(x => /週[日一二三四五六]/.test(x)), s5.find(x => /週/.test(x)) ?? '');
  check('足跡有稱號', s5.some(x => x.includes('稱號')));
  const dayRow = (await nodes()).find(n => /\d+\/\d+\s*週/.test(textOf(n)) && n.frame);
  if (dayRow) {
    await tapXY(dayRow.frame.x + dayRow.frame.width / 2, dayRow.frame.y + dayRow.frame.height / 2, '足跡的一天'); await sleep(2500);
    await shot('12-steps-to-map');
    check('點一天會回到地圖頁', await has('還沒開始記錄') || await has('沒在記錄'));
  }

  // ---------- 6. 製圖：有資料 ----------
  await goTab('製圖'); await sleep(6000); await shot('13-card');
  check('製圖頁有選框', await has('邊框'));
  await tapLabel('換成城堡框', { wait: 2500 }) || await tapLabel('城堡', { contains: true, wait: 2500 });
  await shot('14-card-castle');
  await scrollDown(); await shot('15-card-bottom');
  check('製圖頁捲下去有分享鈕', await has('分享這張'));

  // ---------- 7. 深色模式 ----------
  await simctl(['ui', 'booted', 'appearance', 'dark']); await sleep(1500);
  await shot('16-dark-card');
  await goTab('足跡'); await shot('17-dark-steps');
  await goTab('設定'); await shot('18-dark-settings');
  await goTab('地圖'); await sleep(1500); await shot('19-dark-map');
  await simctl(['ui', 'booted', 'appearance', 'light']); await sleep(800);

  // ---------- 8. 關掉重開，資料還在 ----------
  try { await c.terminateApp(BUNDLE); } catch (e) { log('terminate failed', e?.message); }
  await sleep(1000);
  await simctl(['launch', 'booted', BUNDLE]); await sleep(6000);
  await shot('20-relaunch');
  const again = (await texts()).find(x => /km²/.test(x)) ?? '';
  check('重開後紀錄還在', /km²/.test(again) && !/^0\.000/.test(again.trim()), again);

  log('DONE');
} catch (e) {
  log('ERROR', e?.message ?? String(e));
  if (e?.status) log('http', e.status, JSON.stringify(e.error ?? e.body ?? e.cause ?? '').slice(0, 500));
  process.exitCode = 1;
} finally {
  if (c) { try { c.disconnect(); } catch {} }
  if (inst?.metadata?.id) {
    try { await lim.iosInstances.delete(inst.metadata.id); log('instance deleted', inst.metadata.id); }
    catch (e) { log('DELETE FAILED (clean up manually!)', inst.metadata.id, e?.message); }
  }
  try { // 確認帳號下沒有這個專案開著的機器（別的專案的不動）
    const left = [];
    for await (const i of lim.iosInstances.list()) left.push((i.metadata?.id ?? '?') + ' ' + (i.status?.state ?? '') + ' ' + JSON.stringify(i.metadata?.labels ?? {}));
    log('還開著的機器：' + (left.length ? left.join(' | ') : '沒有'));
  } catch (e) { log('list failed', e?.message); }
  const fails = results.filter(r => !r.ok);
  log('結果：' + (results.length - fails.length) + ' 過，' + fails.length + ' 沒過');
  for (const r of fails) log('  FAIL', r.name, r.note);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  log('total', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  process.exit(process.exitCode ?? 0);
}
