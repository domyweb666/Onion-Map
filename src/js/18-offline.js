// --- 離線地圖：看過的、附近的、下載過的圖磚都留在手機裡，沒網路也畫得出來 ---
// 地圖來源寫成 onion://planet、onion://v/{z}/{x}/{y}、onion://dem/{z}/{x}/{y}，這裡負責先查手機、沒有才上網抓
/*OFFLINE_CORE_START*/
const OFF = {
  planet: 'https://tiles.openfreemap.org/planet',
  dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  cap: 400 * 1048576,      // 總量上限
  minBrowse: 60 * 1048576, // 下載的縣市佔再多，看過的圖磚至少留這麼多
  maxZ: 14, demMaxZ: 12,   // 向量圖磚最細到 z14；高程自動與下載只抓到 z12
  nearKm: 10, nearMinZ: 10, moveKm: 3, areaMinZ: 8,
  jobs: 2, gapMs: 100,     // OpenFreeMap 是免費的公益服務，慢慢抓
  staleMs: 30 * 864e5,     // 存了這麼久、而且地圖出了新版，才順手換新
  timeoutMs: 15000,
  blank: 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEWAAABGTyZaAAAAH0lEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAvg0hAAABYOSdlwAAAABJRU5ErkJggg==', // 海拔 0 的高程圖磚
  // 每個縣市 z8 到 z14 下載的大小（MB），2026-11-25 抽樣量的
  mb: { 臺東縣: 19, 屏東縣: 19, 雲林縣: 17, 彰化縣: 19, 苗栗縣: 18, 新竹縣: 17, 嘉義縣: 22, 高雄市: 36, 宜蘭縣: 14, 連江縣: 2, 金門縣: 4, 臺中市: 28, 澎湖縣: 4, 南投縣: 23, 花蓮縣: 31, 基隆市: 6, 臺北市: 28, 新北市: 42, 臺南市: 42, 桃園市: 28, 嘉義市: 4, 新竹市: 8 }
};
const offXY = (lng, lat, z) => { const n = 2 ** z, r = lat * Math.PI / 180, c = v => Math.max(0, Math.min(n - 1, Math.floor(v))); return [c((lng + 180) / 360 * n), c((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)]; };
// 附近的圖磚：粗的先、近的先
function offNear(lng, lat) {
  const out = [], dy = OFF.nearKm / 111.2, dx = dy / Math.max(0.1, Math.cos(lat * Math.PI / 180));
  for (let z = OFF.nearMinZ; z <= OFF.maxZ; z++) {
    const [x0, y0] = offXY(lng - dx, lat + dy, z), [x1, y1] = offXY(lng + dx, lat - dy, z), [cx, cy] = offXY(lng, lat, z), ring = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ring.push([Math.hypot(x - cx, y - cy), x, y]);
    ring.sort((a, b) => a[0] - b[0]);
    for (const [, x, y] of ring) { out.push('v/' + z + '/' + x + '/' + y); if (z <= OFF.demMaxZ) out.push('d/' + z + '/' + x + '/' + y); }
  }
  return out;
}
// 一個縣市碰得到的圖磚。towns＝55-admin.js 那種 {b, rings:[[外圈, 洞…]]}，圈是攤平的 [經,緯,經,緯…]
function offCounty(towns, inRing) {
  const z = OFF.maxZ, hit = new Set(), add = (lng, lat) => { const [x, y] = offXY(lng, lat, z); hit.add(x * 65536 + y); };
  for (const t of towns) for (const poly of t.rings) {
    let w = 180, s = 90, e = -180, n = -90; const a = poly[0];
    for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { // 邊界：沿著線每隔不到半張圖磚取一點
      const dx = a[i] - a[j], dy = a[i + 1] - a[j + 1], k = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.008));
      for (let q = 0; q < k; q++) add(a[j] + dx * q / k, a[j + 1] + dy * q / k);
      w = Math.min(w, a[i]); e = Math.max(e, a[i]); s = Math.min(s, a[i + 1]); n = Math.max(n, a[i + 1]);
    }
    const [x0, y0] = offXY(w, n, z), [x1, y1] = offXY(e, s, z), N = 2 ** z; // 裡面：圖磚中心在多邊形內
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (hit.has(x * 65536 + y)) continue;
      if (inRing(a, (x + 0.5) / N * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / N))) * 180 / Math.PI)) hit.add(x * 65536 + y);
    }
  }
  const out = []; let lv = hit;
  for (let k = z; k >= OFF.areaMinZ; k--) {
    const up = new Set(), row = [];
    for (const c of lv) { const x = Math.floor(c / 65536), y = c % 65536; row.push('v/' + k + '/' + x + '/' + y); if (k <= OFF.demMaxZ) row.push('d/' + k + '/' + x + '/' + y); up.add((x >> 1) * 65536 + (y >> 1)); }
    out.unshift(...row); lv = up;
  }
  return out;
}

// env：{ store, fetch, now(), online(), delay(ms), onBlank(), onBack() }。store 見下面的 offIDB
function offMake(env) {
  const idx = new Map(); // 鍵 → { n 大小, t 抓的時間, u 最後用到, v 地圖版本, p 哪些縣市要留 }
  let total = 0, tpl = null, ver = '', planetAt = 0, planetP = null, areas = {}, touched = new Set(), blanks = 0, refreshing = 0, evicting = null;
  const wait = new Map(); // 正在抓的：鍵 → { p, ac, refs }
  const dead = new Set(); // 存不進去就別一直試

  const ready = (async () => {
    try {
      const o = await env.store.open();
      for (const [k, m] of o.idx) { idx.set(k, m); total += m.n; }
      areas = o.areas || {};
      if (o.planet) { setPlanet(o.planet.json); planetAt = o.planet.t || 0; }
      for (const id of Object.keys(areas)) if (!areas[id].done) await unpin(id, true); // 上次下載到一半就被關掉的，當成一般看過的圖磚
    } catch (e) { dead.add('all'); }
  })();

  function setPlanet(j) { tpl = j && j.tiles && j.tiles[0] || tpl; const m = /planet\/([^/]+)\//.exec(tpl || ''); ver = m ? m[1] : ver; planet.json = j || planet.json; }
  const planet = { json: null };
  async function grab(url, signal) {
    if (!env.online()) throw new Error('offline');
    const ac = new AbortController(), off = () => ac.abort(), t = setTimeout(off, OFF.timeoutMs);
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', off, { once: true }); }
    try { return await env.fetch(url, { signal: ac.signal }); } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', off); }
  }
  function loadPlanet() {
    return planetP || (planetP = (async () => {
      try {
        const r = await grab(OFF.planet); if (!r.ok) throw new Error('planet ' + r.status);
        const j = await r.json(); if (!j || !j.tiles || !j.tiles[0]) throw new Error('planet');
        setPlanet(j); planetAt = env.now(); back();
        if (!dead.has('all')) env.store.conf('planet', { json: j, t: planetAt }).catch(() => {});
        return j;
      } finally { planetP = null; }
    })());
  }
  // TileJSON：tiles 換成自己的網址，裡面不帶版本，換版時舊圖磚照樣用得到
  async function tileJSON() {
    await ready;
    if (!planet.json) { try { await loadPlanet(); } catch (e) { missed(); } }
    else if (env.now() - planetAt > 6 * 3600e3) loadPlanet().catch(() => {});
    const j = planet.json || { tilejson: '3.0.0', minzoom: 0, maxzoom: OFF.maxZ, vector_layers: [], attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' };
    return Object.assign({}, j, { tiles: ['onion://v/{z}/{x}/{y}'] });
  }

  function missed() { if (!blanks++ && env.onBlank) env.onBlank(); }
  function back() { if (blanks) { blanks = 0; if (env.onBack) env.onBack(); } } // 給過空白、現在又抓得到：請地圖重要一次
  const fill = (t, k) => { const [, z, x, y] = k.split('/'); return t.replace('{z}', z).replace('{x}', x).replace('{y}', y); };
  async function fetchTile(k, signal) {
    const vec = k[0] === 'v';
    if (vec && !tpl) await loadPlanet();
    let r = await grab(fill(vec ? tpl : OFF.dem, k), signal), v = ver;
    if (vec && r.status === 404 && env.now() - planetAt > 60000) { // 可能是地圖換版、舊網址收掉了
      const old = tpl; await loadPlanet().catch(() => {});
      if (tpl !== old) { r = await grab(fill(tpl, k), signal); v = ver; }
    }
    if (vec && (r.status === 404 || r.status === 204)) return { d: new ArrayBuffer(0), v };
    if (!r.ok) throw Object.assign(new Error('圖磚 ' + r.status), { http: r.status });
    return { d: await r.arrayBuffer(), v };
  }
  // 上網抓並存起來。同一張同時有兩個人要，只抓一次；要的人都取消了才真的取消
  function net(k, signal) {
    if (signal && signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    let w = wait.get(k);
    if (!w) {
      const ac = new AbortController(); w = { refs: 0, ac };
      w.p = fetchTile(k, ac.signal).then(o => { save(k, o); back(); return o.d; }).finally(() => { if (wait.get(k) === w) wait.delete(k); });
      w.p.catch(() => {}); wait.set(k, w);
    }
    w.refs++;
    return new Promise((ok, bad) => {
      const off = () => { if (--w.refs <= 0) { w.ac.abort(); if (wait.get(k) === w) wait.delete(k); } bad(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
      if (signal) signal.addEventListener('abort', off, { once: true });
      w.p.then(ok, bad).finally(() => { if (signal) signal.removeEventListener('abort', off); });
    });
  }
  function save(k, o) {
    if (dead.has('all')) return;
    const old = idx.get(k), now = env.now(), m = { n: o.d.byteLength, t: now, u: now, v: o.v };
    if (old && old.p) m.p = old.p;
    total += m.n - (old ? old.n : 0); idx.set(k, m);
    env.store.put(k, o.d.slice(0), m).catch(async () => { // 多半是空間滿了：丟掉一些再試一次
      try { await evict(0.7); await env.store.put(k, o.d.slice(0), m); } catch (e) { if (idx.get(k) === m) { idx.delete(k); total -= m.n; } }
    });
    if (total > room()) evict(0.9);
  }
  const pinned = () => { let n = 0; for (const m of idx.values()) if (m.p) n += m.n; return n; };
  function room() { return Object.keys(areas).length ? Math.max(OFF.cap, pinned() + OFF.minBrowse) : OFF.cap; }
  function evict(keep) { // 最久沒用的先丟，下載的縣市不丟
    return evicting || (evicting = (async () => {
      const lim = room(), goal = Math.min(lim, total) * keep, list = [...idx].filter(e => !e[1].p).sort((a, b) => a[1].u - b[1].u), gone = [];
      for (const [k, m] of list) { if (total <= goal) break; idx.delete(k); touched.delete(k); total -= m.n; gone.push(k); }
      if (gone.length) await env.store.del(gone).catch(() => {});
      return gone.length;
    })().finally(() => { evicting = null; }));
  }
  async function cached(k) {
    const m = idx.get(k); if (!m) return null;
    let d; try { d = await env.store.get(k); } catch (e) { return null; }
    if (!d) { if (idx.get(k) === m) { idx.delete(k); total -= m.n; } return null; }
    m.u = env.now(); touched.add(k);
    if (m.v !== ver && k[0] === 'v' && env.now() - m.t > OFF.staleMs && refreshing < 2 && env.online() && ver) { refreshing++; net(k).catch(() => {}).finally(() => refreshing--); }
    return d;
  }
  function ancestor(k) { let [s, z, x, y] = k.split('/'); for (z = +z, x = +x, y = +y; z > 0;) { z--; x >>= 1; y >>= 1; if (idx.has(s + '/' + z + '/' + x + '/' + y)) return true; } return false; }

  async function handle(url, signal) {
    const m = /^onion:\/\/(planet|v|dem)(?:\/(\d+)\/(\d+)\/(\d+))?/.exec(url);
    if (!m) throw new Error('看不懂 ' + url);
    if (m[1] === 'planet') return { data: await tileJSON() };
    await ready;
    const k = (m[1] === 'v' ? 'v/' : 'd/') + m[2] + '/' + m[3] + '/' + m[4], hit = await cached(k);
    if (hit) return { data: hit };
    try { return { data: (await net(k, signal)).slice(0) }; }
    catch (e) {
      if (e.name === 'AbortError' && signal && signal.aborted) throw e;
      missed();
      // 有比較粗的圖磚：讓地圖拿粗的放大來墊；都沒有才給空白
      if (ancestor(k)) throw Object.assign(new Error('onion-offline'), k[0] === 'd' ? { status: 404 } : {});
      return { data: k[0] === 'v' ? new ArrayBuffer(0) : Uint8Array.from(atob(OFF.blank), c => c.charCodeAt(0)).buffer };
    }
  }

  // 一批圖磚補齊。opt：{ pin 縣市名, signal, onProgress(做完幾張, 共幾張) }。回 { ok, left, stopped }
  async function ensure(keys, opt = {}) {
    await ready;
    let todo = keys.slice(), done = 0, bad = 0, stopped = false; const pinOne = k => { const m = idx.get(k); if (m && opt.pin && !(m.p && m.p.includes(opt.pin))) { m.p = (m.p || []).concat(opt.pin); touched.add(k); } };
    for (let round = 0; round < 2 && todo.length && !stopped; round++) {
      const left = []; let i = 0; bad = 0;
      const worker = async () => {
        while (i < todo.length && !stopped) {
          if (opt.signal && opt.signal.aborted) { stopped = true; break; }
          const k = todo[i++];
          if (!idx.has(k)) {
            try { await net(k, opt.signal); bad = 0; }
            catch (e) {
              if (opt.signal && opt.signal.aborted) { stopped = true; left.push(k); break; }
              left.push(k); if (++bad >= 6 || e.http === 429) { stopped = true; break; }
              await env.delay(1000); continue;
            }
            pinOne(k); done++; if (opt.onProgress) opt.onProgress(done, keys.length);
            await env.delay(OFF.gapMs);
          } else { pinOne(k); done++; if (opt.onProgress && done % 20 === 0) opt.onProgress(done, keys.length); }
        }
      };
      await Promise.all(Array.from({ length: OFF.jobs }, worker));
      todo = left.concat(todo.slice(i));
    }
    await flush();
    return { ok: !todo.length, left: todo.length, stopped };
  }
  async function flush() { // 最後用到的時間與縣市記號，攢一批再寫
    if (!touched.size || dead.has('all')) return;
    const list = [...touched].filter(k => idx.has(k)).map(k => [k, idx.get(k)]); touched = new Set();
    try { await env.store.marks(list); } catch (e) {}
  }
  const saveAreas = () => env.store.conf('areas', areas).catch(() => {});
  async function unpin(id, keep) {
    const gone = [];
    for (const [k, m] of idx) if (m.p && m.p.includes(id)) {
      m.p = m.p.filter(x => x !== id); if (!m.p.length) delete m.p;
      if (!m.p && !keep) { idx.delete(k); touched.delete(k); total -= m.n; gone.push(k); } else touched.add(k);
    }
    delete areas[id]; await saveAreas(); if (gone.length) await env.store.del(gone).catch(() => {}); await flush();
  }
  return {
    ready, handle, ensure, flush, evict,
    has: k => idx.has(k),
    bytes: () => total,
    pinned,
    areas: () => areas,
    async download(id, keys, opt) {
      await ready; areas[id] = { done: false, t: env.now() }; await saveAreas();
      let r; try { r = await ensure(keys, Object.assign({ pin: id }, opt)); } catch (e) { r = { ok: false, left: keys.length }; }
      if (!r.ok) { await unpin(id, true); return r; } // 抓到的留著，下次接著抓
      let n = 0; for (const k of keys) { const m = idx.get(k); if (m) n += m.n; }
      areas[id] = { done: true, t: env.now(), n }; await saveAreas();
      return r;
    },
    remove: id => unpin(id, false),
    async clearSeen() { const gone = []; for (const [k, m] of idx) if (!m.p) { idx.delete(k); total -= m.n; gone.push(k); } touched = new Set([...touched].filter(k => idx.has(k))); if (gone.length) await env.store.del(gone).catch(() => {}); }
  };
}
/*OFFLINE_CORE_END*/

// 圖磚的櫃子：IndexedDB，跟紀錄（kv）分開，備份與清除紀錄都不會碰到它
function offIDB() {
  let db = null;
  const tx = (stores, mode, fn) => new Promise((ok, bad) => { const t = db.transaction(stores, mode); let out; t.oncomplete = () => ok(out && out.result); t.onerror = t.onabort = () => bad(t.error || new Error('idb')); out = fn(t); });
  return {
    open: () => new Promise((ok, bad) => {
      const timer = setTimeout(() => bad(new Error('idb 太久沒開')), 3000), r = indexedDB.open('onion-tiles', 1);
      r.onupgradeneeded = () => ['tile', 'idx', 'conf'].forEach(n => r.result.createObjectStore(n));
      r.onerror = () => { clearTimeout(timer); bad(r.error); };
      r.onsuccess = async () => {
        clearTimeout(timer); db = r.result;
        try {
          const all = s => new Promise((y, n) => { const t = db.transaction(s), k = t.objectStore(s).getAllKeys(), v = t.objectStore(s).getAll(); t.oncomplete = () => y(k.result.map((x, i) => [x, v.result[i]])); t.onerror = () => n(t.error); });
          const conf = Object.fromEntries(await all('conf'));
          ok({ idx: await all('idx'), planet: conf.planet, areas: conf.areas });
        } catch (e) { bad(e); }
      };
    }),
    get: k => tx(['tile'], 'readonly', t => t.objectStore('tile').get(k)),
    put: (k, d, m) => tx(['tile', 'idx'], 'readwrite', t => { t.objectStore('tile').put(d, k); t.objectStore('idx').put(m, k); }),
    marks: list => tx(['idx'], 'readwrite', t => { for (const [k, m] of list) t.objectStore('idx').put(m, k); }),
    del: keys => tx(['tile', 'idx'], 'readwrite', t => { for (const k of keys) { t.objectStore('tile').delete(k); t.objectStore('idx').delete(k); } }),
    conf: (k, v) => tx(['conf'], 'readwrite', t => { t.objectStore('conf').put(v, k); })
  };
}

// --- 接到地圖上 ---
const offline = (() => {
  let blankSince = 0, backTimer = null;
  const core = offMake({
    store: offIDB(), fetch: (u, o) => fetch(u, o), now: () => Date.now(), online: () => navigator.onLine !== false, delay: ms => new Promise(ok => setTimeout(ok, ms)),
    onBlank() { blankSince = Date.now(); },
    onBack() { clearTimeout(backTimer); backTimer = setTimeout(reload, 1500); }
  });
  function reload() { // 網路回來了：剛才給空白的地方重要一次
    if (typeof map === 'undefined') return;
    try { const o = map.getSource('omt'), d = map.getSource('dem'); if (o && o.setUrl) o.setUrl('onion://planet'); if (d && d.setTiles) d.setTiles(d.tiles); } catch (e) {}
  }
  maplibregl.addProtocol('onion', (p, ac) => core.handle(p.url, ac && ac.signal));
  addEventListener('online', () => { if (blankSince) { blankSince = 0; setTimeout(reload, 800); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) core.flush(); });
  setInterval(() => core.flush(), 30000);
  hook.ready.push(() => {
    // 沒網路時地圖拿粗的圖磚墊著，不用當成錯誤；其他錯誤照樣印出來
    map.on('error', e => { if (/onion-offline/.test(String(e && e.error && e.error.message))) { if (map._update) map._update(); } else console.error(e && e.error || e); });
  });

  // --- 自動補附近：有 Wi-Fi（看不出來就當有網路）、知道人在哪，就把 10 公里內補齊 ---
  let lastAt = null, auto = null, down = null;
  const wifi = () => { const c = navigator.connection; return navigator.onLine !== false && !(c && (c.saveData || (c.type && c.type !== 'wifi' && c.type !== 'ethernet' && c.type !== 'unknown' && c.type !== 'other'))); };
  function around(lng, lat) {
    if (auto || down || !wifi()) return;
    if (lastAt && Math.hypot((lng - lastAt[0]) * Math.cos(lat * Math.PI / 180), lat - lastAt[1]) * 111.2 < OFF.moveKm) return;
    const ac = auto = new AbortController(), at = [lng, lat];
    core.ensure(offNear(lng, lat), { signal: ac.signal }).then(r => { if (!r.ok && ac.signal.aborted) return; lastAt = at; if (!r.ok) setTimeout(() => { if (lastAt === at) lastAt = null; }, 600000); }) // 網路不好就過十分鐘再試
      .catch(() => {}).finally(() => { auto = null; paint(); });
  }
  hook.fix.push(f => around(f.lng, f.lat));
  hook.ready.push(() => setTimeout(() => { // 開 app：用最後一個紀錄點當位置，等畫面忙完再開始
    const p = engine.state().points, q = p[p.length - 1]; if (q) around(q[2], q[1]);
  }, 6000));
  document.addEventListener('onion:wiped', () => core.clearSeen().then(paint)); // 看過哪裡也算紀錄，一起清；自己下載的縣市留著

  // --- 設定頁 ---
  let here = null, armed = '', pct = 0;
  const mb = n => n >= 1048576 * 10 ? Math.round(n / 1048576) + ' MB' : (n / 1048576).toFixed(1) + ' MB';
  const btn = (act, text, cls) => '<button class="offBtn press ' + (cls || '') + '" data-off="' + act + '">' + text + '</button>';
  async function locate() { // 地圖中間是哪個縣市
    try { const adm = await loadAdmin(), c = map.getCenter(), t = townAt(adm, c.lng, c.lat); here = t ? { id: adm.counties[t.c].n, c: t.c, adm } : null; } catch (e) { here = null; }
    paint();
  }
  function paint() {
    const el = $('mountOffline'); if (!el || (tab !== 'settings' && el.innerHTML)) return;
    const a = core.areas(), got = Object.keys(a).filter(k => a[k].done);
    let top;
    if (down) top = '<div class="row"><span class="lines"><span class="ttl">正在下載' + esc(down.id) + '</span><span class="meta" id="offPct">' + pctText() + '</span></span>' + btn('stop', '停') + '</div>';
    else if (!here) top = '<div class="row"><span class="lines"><span class="ttl">下載這個縣市</span><span class="meta">先在地圖頁移到台灣的某個縣市</span></span></div>';
    else if (a[here.id] && a[here.id].done) top = ''; // 下面就列著「已下載」
    else top = '<button class="row" data-off="get"><span class="lbl">下載這個縣市</span><span class="val">' + esc(here.id) + ' 約 ' + (OFF.mb[here.id] || 30) + ' MB</span><svg class="chev"><use href="#i-chev"/></svg></button>';
    el.innerHTML = '<div class="section"><h2>離線地圖</h2><div class="group">' + top +
      got.map(id => '<div class="row"><span class="lines"><span class="ttl">已下載：' + esc(id) + '</span><span class="meta">' + mb(a[id].n || 0) + '</span></span>' + btn('del:' + id, armed === id ? '確定刪除' : '刪除', 'bad') + '</div>').join('') +
      '<div class="row"><span class="lbl">占用空間</span><span class="val" id="offUse">' + mb(core.bytes()) + '</span></div></div>' +
      '<p class="foot">看過的地方和你附近，沒網路也看得到。要去收訊不好的地方，先把地圖移過去，再回來下載那個縣市。</p></div>';
  }
  const pctText = () => pct + '%，隨時可以停，下次接著抓';
  async function get() {
    if (down || !here) return;
    const h = here, est = (OFF.mb[h.id] || 30) * 1048576;
    if (navigator.onLine === false) return toast('現在沒有網路');
    if (core.pinned() + est > OFF.cap) return toast('下載的地圖快滿了，先刪掉一個縣市', 4000);
    if (auto) auto.abort();
    const ac = new AbortController(); down = { id: h.id, ac }; pct = 0; paint();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    const towns = h.adm.towns.filter(t => t.c === h.c), r = await core.download(h.id, offCounty(towns, inRing), { signal: ac.signal,
      onProgress(n, all) { const p = Math.floor(n / all * 100); if (p === pct) return; pct = p; const e = $('offPct'); if (e) { e.textContent = pctText(); $('offUse').textContent = mb(core.bytes()); } } });
    down = null; paint();
    if (r.ok) toast(h.id + '下載好了'); else if (!ac.signal.aborted) toast('網路不穩，抓到 ' + pct + '%，等一下再按一次會接著抓', 4000);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-off]'); if (!b) return;
    const act = b.dataset.off;
    if (act === 'get') get();
    else if (act === 'stop') { if (down) down.ac.abort(); }
    else if (act.startsWith('del:')) { const id = act.slice(4); if (armed !== id) { armed = id; paint(); return; } armed = ''; core.remove(id).then(() => { paint(); toast(id + '刪掉了'); }); }
  });
  hook.tab.push(t => { if (t === 'settings') { armed = ''; paint(); locate(); } });
  hook.ready.push(() => core.ready.then(paint));
  return { core, around, reload, get downloading() { return down && down.id; } };
})();
