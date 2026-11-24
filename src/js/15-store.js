// --- 儲存 ---
// 一個小檔案櫃 kv：iOS 存成 Documents/onion/ 底下的檔案（跟著 iCloud 手機備份走），網頁存 IndexedDB。
// 內容：meta.json（總表）、cells/<分片>.json（探索格子）、days/<日期>.json（那天的軌跡點），其他模組自己用別的前綴。
// 只重寫有變的那幾個。寫的時候先寫 <檔名>.tmp 再寫正式檔，寫到一半斷電，下次讀 .tmp。
const kv = (() => {
  const ROOT = 'onion/', DIR = 'DOCUMENTS';
  if (NATIVE) return {
    async get(k) { return (await FS.readFile({ path: ROOT + k, directory: DIR, encoding: 'utf8' })).data; }, // 沒有這個檔會丟例外
    async set(k, text) { await FS.writeFile({ path: ROOT + k, data: text, directory: DIR, encoding: 'utf8', recursive: true }); },
    async del(k) { try { await FS.deleteFile({ path: ROOT + k, directory: DIR }); } catch (e) {} },
    async list(prefix) { // prefix 是資料夾，例如 'days/'；根目錄給 ''
      try { return (await FS.readdir({ path: ROOT + prefix, directory: DIR })).files.filter(f => f.type !== 'directory').map(f => prefix + f.name); } catch (e) { return []; }
    }
  };
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, bad) => {
    const r = indexedDB.open('onion', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => { dbp = null; bad(r.error); };
  }));
  const run = async (mode, fn) => { const d = await db(); return new Promise((ok, bad) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = t.onabort = () => bad(t.error); }); };
  return {
    async get(k) { const v = await run('readonly', s => s.get(k)); if (v === undefined) throw new Error('沒有 ' + k); return v; },
    async set(k, text) { await run('readwrite', s => s.put(text, k)); },
    async del(k) { await run('readwrite', s => s.delete(k)); },
    async list(prefix) { const all = await run('readonly', s => s.getAllKeys()); return all.filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')); }
  };
})();
async function kvTry(k) { try { return await kv.get(k); } catch (e) { return null; } }
async function kvSafeSet(k, text) { await kv.set(k + '.tmp', text); await kv.set(k, text); await kv.del(k + '.tmp'); }
async function kvJSON(k) { // 正式檔壞了就讀 .tmp；兩個都不行回 undefined，並把壞掉的原文另存一份，不讓它被蓋掉
  for (const name of [k, k + '.tmp']) { const raw = await kvTry(name); if (raw != null) { try { return JSON.parse(raw); } catch (e) { try { await kv.set('broken/' + name.replace(/\//g, '_') + '-' + Date.now(), raw); } catch (x) {} } } }
  return undefined;
}

const store = { locked: false, why: '' }; // locked：檔案在、但這次讀不到。鎖住不存，免得用空白蓋掉舊紀錄
let saveTimer = null, saving = null, saveAgain = false;
function persistNow() {
  if (store.locked) return Promise.resolve(false);
  if (saving) { saveAgain = true; return saving; }
  return saving = (async () => {
    let ok = true; const r = engine.takeSaves();
    try {
      for (const k of r.days) { const pts = engine.dayPoints(k); if (pts.length) await kvSafeSet('days/' + k + '.json', JSON.stringify(pts)); }
      for (const k of r.shards) await kvSafeSet('cells/' + k + '.json', JSON.stringify(engine.shardData(k)));
      if (r.meta) await kvSafeSet('meta.json', JSON.stringify(engine.meta()));
    } catch (e) { ok = false; engine.putBackSaves(r); toast('存檔失敗，等一下會再試：' + (e.message || e)); saveSoon(8000); }
    saving = null;
    if (saveAgain) { saveAgain = false; saveSoon(); }
    return ok;
  })();
}
// 背景記錄時每 10 秒最多寫一次，切到背景或停止記錄時立刻寫
function saveSoon(ms) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, ms != null ? ms : (NATIVE && recording ? 10000 : 1500));
}
function flushSave() { clearTimeout(saveTimer); saveTimer = null; return persistNow(); }
function extSave() { engine.touchMeta(); saveSoon(); } // 模組改了 ext 裡的東西之後叫這個
function ext(name, init) { const e = engine.state().ext; if (e[name] === undefined) e[name] = init; return e[name]; }

async function loadSaved() {
  const have = new Set(await kv.list('')), shardKeys = await kv.list('cells/'), dayKeys = (await kv.list('days/')).filter(k => k.endsWith('.json'));
  if (!have.has('meta.json') && !have.has('meta.json.tmp') && !shardKeys.length && !dayKeys.length) return loadLegacy();
  const m = await kvJSON('meta.json');
  if (m === undefined && have.has('meta.json') && await kvTry('meta.json') == null) { store.locked = true; store.why = '紀錄暫時讀不到'; toast('紀錄暫時讀不到，這次先不存檔，重開洋蔥再試一次', 6000); return false; }
  if (m) engine.loadMeta(m);
  const lock = () => { store.locked = true; store.why = '有一部分紀錄暫時讀不到'; toast('有一部分紀錄暫時讀不到，這次先不存檔，重開洋蔥再試一次', 6000); };
  for (const k of shardKeys) if (k.endsWith('.json')) { const o = await kvJSON(k); if (o) engine.loadCells(o); else if (await kvTry(k) == null) lock(); }
  const days = engine.state().days;
  const cut = dayKey(Date.now() - CFG.keepDays * 864e5), pts = [];
  for (const k of dayKeys) {
    const d = k.slice(5, -5);
    if (d < cut && days[d]) continue;
    const list = await kvJSON(k); if (!list) continue;
    if (!days[d] || days[d].n !== list.length) days[d] = engine.summarize(list); // 總表沒跟上（例如寫到一半斷電）就用那天的檔重算
    if (d >= cut) pts.push(...list);
  }
  engine.loadPoints(pts); engine.clean();
  return true;
}
async function loadLegacy() { // 舊版：整包一個 JSON。讀進來拆成新格式，舊檔留著當備份
  let raw = null;
  if (NATIVE) { try { raw = (await FS.readFile({ path: DATA_FILE, directory: 'DOCUMENTS', encoding: 'utf8' })).data; } catch (e) {} }
  if (!raw) { try { raw = localStorage.getItem(STORE) || localStorage.getItem('digua.v1'); } catch (e) {} }
  if (!raw) return false;
  try { engine.load(JSON.parse(raw)); } catch (e) { return false; }
  await persistNow();
  return true;
}
// 某一天的軌跡點：最近的在記憶體，更早的讀檔
async function loadDay(key) {
  const p = engine.dayPoints(key); if (p.length) return p;
  return (await kvJSON('days/' + key + '.json')) || [];
}
async function exportAll() { // 備份檔 v2：跟 v1 一樣是一個 JSON，多了 ext（地點、印章…）；points 是全部的天
  await flushSave();
  const s = engine.state(), points = [];
  for (const k of Object.keys(s.days).sort()) points.push(...await loadDay(k));
  const ext = Object.assign({}, s.ext); delete ext.painter; // 配對密碼不進備份
  return { v: 2, cells: s.cells, flights: s.flights, gaps: s.gaps, points, km: s.km, ext };
}
async function importAll(d) { // 還原備份（v1、v2 都吃）：整個換掉
  if (!d || typeof d !== 'object' || !d.cells) throw new Error('不是洋蔥的備份檔');
  const painter = engine.state().ext.painter;
  await wipeFiles(); engine.load(d); if (painter) engine.state().ext.painter = painter;
  store.locked = false; await flushSave();
}
async function wipeFiles() {
  clearTimeout(saveTimer); saveTimer = null; if (saving) await saving;
  for (const p of ['days/', 'cells/', 'cards/', 'base/']) for (const k of await kv.list(p)) await kv.del(k);
  for (const k of await kv.list('')) await kv.del(k);
  try { localStorage.removeItem(STORE); localStorage.removeItem('digua.v1'); } catch (e) {}
  if (NATIVE) FS.deleteFile({ path: DATA_FILE, directory: 'DOCUMENTS' }).catch(() => {});
}
async function wipeAll() { engine.clear(); engine.clean(); await wipeFiles(); store.locked = false; }
