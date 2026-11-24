// ===== 地點：長按地圖取名、待過的地方主動問要不要取名、足跡頁列出來 =====
// 資料 ext('places', [])：{id, lat, lng, name, icon, note, t, days?}
// 問過什麼 ext('placesAsked', {skip:[[lat,lng]], day:'YYYY-MM-DD', seen:[[lat,lng]]})

/*PLACES_LOGIC_START*/
// 純邏輯，不碰畫面與地圖（tests/places.test.mjs 直接讀這一段）。點的格式 [秒, lat, lng, 精度, 'w'|'v'|'f']
const PLACES_LOGIC = (() => {
  const C = {
    radius: 60, minMin: 12,        // 這麼多公尺內待滿幾分鐘算停留（跟 tools/daycard/daycard.py 的 find_stops 一樣）
    askGapHr: 3,                   // 要問的停留：中間斷訊超過這麼久就不算同一次，免得把關掉記錄的時間也算進去
    askDays: 7,                    // 只問最近幾天
    near: 80,                      // 這麼近就當同一個地方
    perDay: 3,                     // 一天最多問幾個
    homeDays: 60, homeTop: 2,      // 最近幾天裡待最久的前幾個點不問（家、公司）
    homeGapHr: 16, homeMinHours: 3, homeNear: 120, // 家的停留容許隔夜沒訊號；待不滿幾小時不算家；家的範圍放寬一點
    poiStop: 80, poiPress: 120, parkWide: 100     // 建議名字往外找多遠
  };
  const RAD = Math.PI / 180;
  function dist(a, b, c, d) { // (lat, lng, lat, lng) 公尺
    const s = Math.sin((c - a) * RAD / 2), t = Math.sin((d - b) * RAD / 2);
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(s * s + Math.cos(a * RAD) * Math.cos(c * RAD) * t * t)));
  }
  function findStops(pts, o) {
    const R = (o && o.radius) || C.radius, need = ((o && o.minMin) || C.minMin) * 60, gap = ((o && o.gapHr) || C.askGapHr) * 3600, out = [];
    for (let i = 0; i < pts.length;) {
      const a = pts[i]; let j = i;
      while (j + 1 < pts.length && pts[j + 1][4] !== 'f' && pts[j + 1][0] - pts[j][0] <= gap && dist(a[1], a[2], pts[j + 1][1], pts[j + 1][2]) <= R) j++;
      const sec = pts[j][0] - a[0];
      if (sec >= need) {
        let la = 0, ln = 0; for (let k = i; k <= j; k++) { la += pts[k][1]; ln += pts[k][2]; }
        out.push({ lat: la / (j - i + 1), lng: ln / (j - i + 1), t0: a[0], t1: pts[j][0], minutes: Math.round(sec / 60), i0: i, i1: j });
        i = j + 1;
      } else i++;
    }
    return out;
  }
  const isNear = (list, lat, lng, m) => list.some(q => dist(lat, lng, q[0] != null ? q[0] : q.lat, q[1] != null ? q[1] : q.lng) <= m);
  function homes(pts, nowSec) { // 待最久的前幾個點
    const cut = nowSec - C.homeDays * 86400, groups = [];
    for (const s of findStops(pts.filter(p => p[0] >= cut), { gapHr: C.homeGapHr })) {
      const g = groups.find(x => dist(x.lat, x.lng, s.lat, s.lng) <= C.homeNear);
      if (g) g.min += s.minutes; else groups.push({ lat: s.lat, lng: s.lng, min: s.minutes });
    }
    return groups.filter(g => g.min >= C.homeMinHours * 60).sort((a, b) => b.min - a.min).slice(0, C.homeTop);
  }
  // 現在該問哪一個（沒有就 null）。asked：{skip, day, seen}；today 是 'YYYY-MM-DD'
  function nextAsk({ pts, places, asked, nowSec, today, recording }) {
    const old = (asked && asked.old) || [];
    const cut = nowSec - C.askDays * 86400, recent = pts.filter(p => p[0] >= cut); if (!recent.length) return null;
    const skip = (asked && asked.skip) || [], seen = asked && asked.day === today ? asked.seen || [] : [];
    const stops = findStops(recent), home = homes(pts, nowSec), last = recent[recent.length - 1];
    for (const s of stops.reverse()) { // 新的先問
      if (recording && s.i1 === recent.length - 1) continue; // 還在那裡
      if (recording && dist(last[1], last[2], s.lat, s.lng) <= C.radius) continue;
      if (old.some(r => s.t0 >= r[0] && s.t0 <= r[1])) continue; // 匯入的足跡不問
      if (isNear(places, s.lat, s.lng, C.near) || isNear(skip, s.lat, s.lng, C.near) || isNear(home, s.lat, s.lng, C.homeNear)) continue;
      if (seen.length >= C.perDay && !isNear(seen, s.lat, s.lng, C.near)) continue;
      return s;
    }
    return null;
  }
  // 出現一張卡就記一次；同一個地方重開 app 再出現不重複算
  function markSeen(asked, s, today) {
    if (asked.day !== today) { asked.day = today; asked.seen = []; }
    if (!isNear(asked.seen, s.lat, s.lng, C.near)) asked.seen.push([+s.lat.toFixed(5), +s.lng.toFixed(5)]);
    return asked;
  }
  function markSkip(asked, s) { asked.skip = asked.skip || []; if (!isNear(asked.skip, s.lat, s.lng, C.near)) asked.skip.push([+s.lat.toFixed(5), +s.lng.toFixed(5)]); return asked; }
  // 匯入的那幾天記下來，待過的地方不問。只要記最近幾天的，更早的本來就不問。list：[[開始秒, 結束秒]…]，回傳有沒有變
  function markOld(asked, list, nowSec) {
    const cut = nowSec - C.askDays * 86400, was = asked.old || [], now = [...was, ...list].filter(r => r[1] >= cut);
    if (!now.length && !was.length) return false;
    asked.old = now; return true;
  }
  function stayText(min) {
    if (min < 60) return min + ' 分鐘';
    const h = Math.floor(min / 60), m = min % 60;
    return h + ' 小時' + (h < 5 && m >= 10 ? ' ' + m + ' 分鐘' : '');
  }
  // 公共地點 → 建議名字。f：[{name, cls, sub, lat, lng}]
  const DULL = /^(bus|bus_stop|parking|bicycle_parking|bicycle_rental|motorcycle_parking|atm|toilets|waste_basket|recycling|entrance|subway_entrance|gate|bollard|information|post_box|telephone|drinking_water|bench|shelter|fuel|charging_station|vending_machine|car_wash|lift_gate|crossing|picnic_site|fire_hydrant|taxi|post|hairdresser|lawyer|dentist|office)$/;
  function suggest(f, lat, lng, maxM, n) {
    const best = new Map();
    for (const q of f) {
      if (!q.name || q.name.length > 16 || DULL.test(q.cls || '') || DULL.test(q.sub || '')) continue;
      const d = dist(lat, lng, q.lat, q.lng); if (d > maxM + (q.cls === 'park' ? C.parkWide : 0)) continue; // 公園很大，點畫在正中間
      const old = best.get(q.name); if (!old || d < old.d) best.set(q.name, { name: q.name, cls: q.cls, sub: q.sub, d });
    }
    return [...best.values()].sort((a, b) => a.d - b.d).slice(0, n || 3);
  }
  // 圖示照名字猜；名字看不出來再看公共地點的類別
  const BY_NAME = [
    ['home', /家$|老家|宿舍|住處|阿[嬤公]/], ['cafe', /咖啡|coffee|caf[eé]|茶|甜點|bakery|麵包|冰/i], ['work', /公司|辦公|工作|office|大樓|商辦/i],
    ['food', /餐|飯|麵|食|店小|火鍋|燒|牛肉|小吃|夜市|便當|早午?餐|餃|壽司|拉麵|滷|粥|披薩|漢堡|bistro|kitchen/i],
    ['temple', /[廟宮寺]$|[廟宮寺]|教堂|教會|聖殿/], ['station', /車站|捷運|高鐵|站$|機場|轉運|碼頭/], ['mountain', /山$|[^中]山|步道|登山|峰|岳|嶺/],
    ['water', /河|溪|海|湖|潭|灘|港|埤|瀑|泳/], ['tree', /公園|森林|花園|農場|植物園|綠地|操場/], ['book', /書|圖書|學校|國小|國中|高中|大學|教室|補習|博物|美術|展|館$/],
    ['shop', /超市|全聯|百貨|商場|購物|市場|量販|商店|門市|7-?11|全家便利|寶雅|家樂福|mall|shop|store/i]
  ];
  const BY_CLS = { cafe: 'cafe', bakery: 'cafe', ice_cream: 'cafe', tea: 'cafe', restaurant: 'food', fast_food: 'food', food: 'food', bar: 'food', beer: 'food',
    shop: 'shop', grocery: 'shop', clothing_store: 'shop', mall: 'shop', park: 'tree', garden: 'tree', playground: 'tree', place_of_worship: 'temple',
    railway: 'station', bus: 'station', airport: 'station', harbor: 'water', swimming: 'water', school: 'book', college: 'book', library: 'book', museum: 'book', art_gallery: 'book' };
  function guessIcon(name, cls) { for (const [id, re] of BY_NAME) if (re.test(name || '')) return id; return BY_CLS[cls] || 'flag'; }
  return { C, dist, findStops, homes, nextAsk, markSeen, markSkip, markOld, stayText, suggest, guessIcon, isNear };
})();
/*PLACES_LOGIC_END*/

// --- 圖示：24 格的線條，跟 UI 同一套筆畫 ---
const PLACE_ICONS = [
  ['flag', '旗子', 'M6 21V4M6 4.5c4-2 7 2 12 0v8c-5 2-8-2-12 0'],
  ['home', '家', 'M3.5 11.5 12 4l8.5 7.5M6 10v9.5h12V10M10 19.5v-5h4v5'],
  ['work', '工作', 'M4 8.5h16v11H4zM9 8.5V5.5h6v3M4 13h16M12 12v2.5'],
  ['food', '吃飯', 'M4 11h16c0 4.5-3 8-8 8s-8-3.5-8-8ZM8 8c-1-1.2 1-2 0-3.5M12 8c-1-1.2 1-2 0-3.5M16 8c-1-1.2 1-2 0-3.5'],
  ['cafe', '咖啡', 'M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M9 6V4M12.5 6V4'],
  ['shop', '買東西', 'M5.5 8.5h13l1 11.5h-15zM9 11V7a3 3 0 0 1 6 0v4'],
  ['tree', '公園', 'M12 21v-6M12 15c-4 0-6.5-2-6.5-5 0-2 1.2-3.2 2.5-3.6C8.5 4.2 10 3 12 3s3.5 1.2 4 3.4c1.3.4 2.5 1.6 2.5 3.6 0 3-2.5 5-6.5 5Z'],
  ['mountain', '山', 'M2.5 19 9.5 6.5l4.5 8 2-3.5 5.5 8zM7.6 10l1.9 1.6 1.7-1.6'],
  ['water', '水邊', 'M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0'],
  ['temple', '廟', 'M3 9.5c3.5 0 6.5-2 9-5 2.5 3 5.5 5 9 5M6 9.5V20M18 9.5V20M4 20h16M10 20v-5.5h4V20M6 12.5h12'],
  ['station', '車站', 'M7 4h10a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2ZM5 11h14M8.5 14h.01M15.5 14h.01M8 17l-2 3.5M16 17l2 3.5'],
  ['book', '看書', 'M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5ZM12 6.5v13']
];
function placeIconSvg(id) { const d = (PLACE_ICONS.find(x => x[0] === id) || PLACE_ICONS[0])[2]; return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; }

// --- 給別的模組用 ---
function placeList() { return ext('places', []); }
function placeNear(lat, lng, m) { // 最近的、夠近的那一個，沒有回 null
  let best = null, bd = m || PLACES_LOGIC.C.near;
  for (const p of placeList()) { const d = PLACES_LOGIC.dist(lat, lng, p.lat, p.lng); if (d <= bd) { bd = d; best = p; } }
  return best;
}
function placeFly(lat, lng, zoom) { follow = false; closeSheet(); go('map'); map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), zoom || 16), duration: 1200 }); }

(() => {
  const L = PLACES_LOGIC;
  const asked = () => ext('placesAsked', { skip: [], day: '', seen: [] });
  const nowSec = () => Math.floor(Date.now() / 1000);

  // --- 公共地點（圖磚裡的 poi）。附近的圖磚沒載好就是空的 ---
  function pois() {
    let fs = []; try { fs = map.querySourceFeatures('omt', { sourceLayer: 'poi', filter: ['has', 'name'] }); } catch (e) {}
    return fs.filter(f => f.geometry && f.geometry.type === 'Point').map(f => ({ name: f.properties['name:zh-Hant'] || f.properties['name:zh'] || f.properties.name,
      cls: f.properties.class, sub: f.properties.subclass, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  }
  const chipsHtml = list => list.map((s, i) => '<button class="plChip press" data-sug="' + i + '">' + esc(s.name) + '</button>').join('');

  // --- 地圖上的標記 ---
  const marks = new Map();
  function draw() {
    const list = placeList(), keep = new Set(list.map(p => p.id));
    for (const [id, m] of marks) if (!keep.has(id)) { m.mk.remove(); marks.delete(id); }
    for (const p of list) {
      let m = marks.get(p.id);
      if (!m) {
        const el = document.createElement('button'); el.className = 'plMk'; el.type = 'button';
        el.addEventListener('click', e => { e.stopPropagation(); const q = placeList().find(x => x.id === p.id); if (q) edit(q); });
        m = { el, mk: new maplibregl.Marker({ element: el, anchor: 'center' }) }; marks.set(p.id, m);
        m.mk.setLngLat([p.lng, p.lat]).addTo(map);
      }
      m.mk.setLngLat([p.lng, p.lat]);
      m.el.setAttribute('aria-label', '地點：' + p.name);
      m.el.innerHTML = '<i>' + placeIconSvg(p.icon) + '</i><span>' + esc(p.name) + '</span>';
    }
  }
  function tier() { const z = map.getZoom(), c = $('map').classList; c.toggle('plFar', z < 11); c.toggle('plMid', z >= 11 && z < 13.5); }
  map.on('zoom', tier); tier();

  function changed() { extSave(); draw(); fill(); document.dispatchEvent(new Event('onion:places')); }
  function add(o) {
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), lat: +o.lat.toFixed(6), lng: +o.lng.toFixed(6), name: o.name, icon: o.icon || L.guessIcon(o.name, o.cls), note: o.note || '', t: Date.now() };
    if (o.days) p.days = o.days;
    placeList().push(p); changed(); return p;
  }

  function askPin(lat, lng) { const el = document.createElement('div'); el.className = 'plAskPin'; el.textContent = '?'; return new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map); }
  let pin = null, spot = null; // pin：提問卡問的點；spot：長按要取名的點
  // --- 抽屜：取名或改名。o：{lat, lng, 既有地點欄位…, sug?, onSave?} ---
  let editing = false;
  function edit(o) {
    const isNew = !o.id, sug = isNew ? (o.sug || L.suggest(pois(), o.lat, o.lng, L.C.poiPress, 3)) : [];
    let icon = o.icon || 'flag', picked = !isNew, cls = '';
    const b = openSheet(
      '<h2>' + (isNew ? '這裡叫什麼？' : '改這個地點') + '</h2>' +
      (sug.length ? '<div class="plChips" aria-label="附近的地方">' + chipsHtml(sug) + '</div>' : '') +
      '<div class="plFields"><input id="plName" class="plField" type="text" maxlength="20" placeholder="名字" aria-label="名字" enterkeyhint="done" autocomplete="off">' +
      '<input id="plNote" class="plField" type="text" maxlength="40" placeholder="寫一行字（可以不寫）" aria-label="寫一行字" enterkeyhint="done" autocomplete="off"></div>' +
      '<div class="plIcons" role="radiogroup" aria-label="圖示">' + PLACE_ICONS.map(([id, n]) => '<button role="radio" data-ic="' + id + '" aria-label="' + n + '">' + placeIconSvg(id) + '</button>').join('') + '</div>' +
      '<div class="actions"><button id="plSave" class="btn primary full press">存好</button>' +
      (isNew ? '<button class="btn plain full press" data-close>先不要</button>' : '<button id="plDel" class="btn plain full press plDel">刪掉這個地點</button>') + '</div>');
    const nm = $('plName'), nt = $('plNote'), save = $('plSave');
    nm.value = o.name || ''; nt.value = o.note || '';
    const show = () => {
      if (!picked) icon = L.guessIcon(nm.value, cls);
      b.querySelectorAll('[data-ic]').forEach(x => x.setAttribute('aria-checked', x.dataset.ic === icon));
      b.querySelectorAll('[data-sug]').forEach(x => x.classList.toggle('on', sug[+x.dataset.sug].name === nm.value));
      save.disabled = !nm.value.trim();
    };
    nm.oninput = show;
    nm.onkeydown = nt.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); };
    b.querySelectorAll('[data-ic]').forEach(x => x.onclick = () => { icon = x.dataset.ic; picked = true; show(); });
    b.querySelectorAll('[data-sug]').forEach(x => x.onclick = () => { const s = sug[+x.dataset.sug]; nm.value = s.name; cls = s.cls; show(); });
    save.onclick = () => {
      const name = nm.value.trim(); if (!name) return;
      if (isNew) { add({ lat: o.lat, lng: o.lng, name, icon, note: nt.value.trim(), days: o.days }); if (o.onSave) o.onSave(); }
      else { const q = placeList().find(x => x.id === o.id); if (q) { q.name = name; q.icon = icon; q.note = nt.value.trim(); } changed(); }
      closeSheet(); toast('「' + name + '」存好了');
    };
    const del = $('plDel');
    if (del) del.onclick = () => {
      if (!del.dataset.arm) { del.dataset.arm = '1'; del.textContent = '再按一次，確定刪掉'; return; }
      const l = placeList(), i = l.findIndex(x => x.id === o.id); if (i >= 0) l.splice(i, 1);
      changed(); closeSheet(); toast('刪掉了');
    };
    show(); editing = true;
    if (isNew) { // 抽屜會蓋住下半部：把要取名的點移到上面看得到的地方，插一個「?」
      if (!pin) { spot = askPin(o.lat, o.lng); }
      follow = false; map.easeTo({ center: [o.lng, o.lat], offset: [0, -Math.round(innerHeight * 0.33)], duration: 500 });
    }
  }

  // --- 長按地圖（觸控 500 毫秒不動；滑鼠右鍵） ---
  let hold = null, fired = false;
  const sheetOpen = () => !$('sheetHost').hidden;
  function pressAt(ll) { if (tab === 'map' && !sheetOpen()) edit({ lat: ll.lat, lng: ll.lng }); }
  const unhold = () => { clearTimeout(hold && hold.timer); hold = null; };
  map.on('touchstart', e => {
    unhold(); fired = false;
    if (e.points.length !== 1 || (e.originalEvent.target.closest && e.originalEvent.target.closest('.plMk'))) return;
    hold = { x: e.point.x, y: e.point.y, timer: setTimeout(() => { const ll = e.lngLat; hold = null; fired = true; pressAt(ll); }, 500) };
  });
  map.on('touchmove', e => { if (hold && (e.points.length !== 1 || Math.hypot(e.point.x - hold.x, e.point.y - hold.y) > 10)) unhold(); });
  map.on('touchend', unhold); map.on('touchcancel', unhold); map.on('dragstart', unhold);
  // 長按放開時的點擊要吃掉，不然會落在剛打開的抽屜上（外面＝馬上被關掉，裡面＝按到建議的名字）。iOS 長按放開還是會補一下點擊，擋 touchend 擋不住
  let deaf = 0;
  document.addEventListener('touchstart', () => { fired = false; }, { passive: true, capture: true });
  for (const ev of ['touchend', 'touchcancel']) document.addEventListener(ev, e => { if (fired) { fired = false; deaf = performance.now() + 450; if (e.cancelable) e.preventDefault(); } }, { passive: false, capture: true });
  document.addEventListener('click', e => { if (performance.now() < deaf) { e.preventDefault(); e.stopPropagation(); } }, true);
  map.on('contextmenu', e => { if (e.originalEvent.target.closest && e.originalEvent.target.closest('.plMk')) return; e.preventDefault(); if (!fired) pressAt(e.lngLat); });

  // --- 待過的地方，問一句 ---
  let ask = null, back = false, offered = false; // offered：這次打開已經問過一張了
  function hideAsk() { $('mapAsk').hidden = true; $('mapAsk').innerHTML = ''; ask = null; if (pin) { pin.remove(); pin = null; } }
  function doneAsk() { // 答完：原本在跟著位置走的，回到跟隨
    const b = back; hideAsk(); if (b && lastPoint()) { follow = true; const l = lastPoint(); map.easeTo({ center: [l[2], l[1]], duration: 900 }); }
  }
  function whenText(s) {
    const d = new Date(s.t0 * 1000), k = dayKey(s.t0), now = Date.now();
    const day = k === dayKey(now) ? '今天' : k === dayKey(now - 864e5) ? '昨天' : (d.getMonth() + 1) + '/' + d.getDate();
    return day + ' ' + hm(s.t0 * 1000) + '–' + hm(s.t1 * 1000);
  }
  function drawAsk() {
    const s = ask; if (!s) return;
    $('mapAsk').innerHTML = '<div class="plAskText"><span class="meta">' + whenText(s) + '</span><b>你在這裡待了 ' + L.stayText(s.minutes) + '，<br>要幫它取名嗎？</b></div>' +
      (s.sug.length ? '<div class="plChips">' + chipsHtml(s.sug) + '</div>' : '') +
      '<div class="plAskBtns"><button class="btn secondary press" data-a="self">自己取</button><button class="btn plain press" data-a="skip">跳過</button></div>';
    $('mapAsk').hidden = false;
  }
  function maybeAsk() {
    if (ask || offered || document.hidden || tab !== 'map' || sheetOpen() || store.locked || simOn) return;
    const s = L.nextAsk({ pts: engine.state().points, places: placeList(), asked: asked(), nowSec: nowSec(), today: dayKey(Date.now()), recording });
    if (!s) return;
    offered = true; ask = s; s.sug = []; L.markSeen(asked(), s, dayKey(Date.now())); extSave();
    back = follow; follow = false;
    pin = askPin(s.lat, s.lng);
    map.easeTo({ center: [s.lng, s.lat], zoom: Math.max(15, Math.min(17, map.getZoom())), duration: 900, offset: [0, -80] });
    drawAsk();
    // 那附近的圖磚載好才有建議名字
    const look = () => { if (ask !== s || s.sug.length) return; s.sug = L.suggest(pois(), s.lat, s.lng, L.C.poiStop, 3); if (s.sug.length) drawAsk(); };
    map.once('idle', look); setTimeout(look, 2500); setTimeout(look, 6000);
  }
  $('mapAsk').addEventListener('click', e => {
    const s = ask; if (!s) return;
    const g = e.target.closest('[data-sug]'), a = e.target.closest('[data-a]');
    if (g) { const q = s.sug[+g.dataset.sug]; add({ lat: s.lat, lng: s.lng, name: q.name, cls: q.cls, days: [dayKey(s.t0)] }); doneAsk(); toast('「' + q.name + '」存好了'); }
    else if (a && a.dataset.a === 'skip') { L.markSkip(asked(), s); extSave(); doneAsk(); }
    else if (a) edit({ lat: s.lat, lng: s.lng, sug: s.sug, days: [dayKey(s.t0)], onSave: doneAsk });
  });
  let visibleTimer = null;
  function onVisible() { if (document.hidden) return; offered = false; clearTimeout(visibleTimer); visibleTimer = setTimeout(maybeAsk, 1200); }
  document.addEventListener('visibilitychange', onVisible);
  hook.tab.push(t => { if (t === 'map') maybeAsk(); });
  // 邊走邊開著畫面：卡片問的那個點如果又走回去了，先收起來，離開再問
  hook.fix.push(f => { if (ask && recording && !editing && L.dist(f.lat, f.lng, ask.lat, ask.lng) <= L.C.radius) { offered = false; hideAsk(); } });
  document.addEventListener('onion:sheetclosed', () => { editing = false; if (spot) { spot.remove(); spot = null; } });

  // --- 足跡頁 ---
  const rowHtml = p => '<button class="row" data-pl="' + esc(p.id) + '"><span class="plIc">' + placeIconSvg(p.icon) + '</span><div class="lines"><span class="ttl">' + esc(p.name) + '</span>' +
    (p.note ? '<span class="meta">' + esc(p.note) + '</span>' : '') + '</div><svg class="chev"><use href="#i-chev"/></svg></button>';
  function newest() { return placeList().slice().sort((a, b) => b.t - a.t); }
  function fill() {
    const el = $('mountPlaces'); if (!el) return;
    const list = newest(); el.hidden = !list.length;
    if (!list.length) { el.innerHTML = ''; return; }
    el.className = 'section';
    el.innerHTML = '<h2>取過名字的地方</h2><div class="group">' + list.slice(0, 5).map(rowHtml).join('') +
      (list.length > 5 ? '<button class="row" data-all><span class="lbl">看全部</span><span class="val">' + list.length + ' 個</span><svg class="chev"><use href="#i-chev"/></svg></button>' : '') + '</div>';
    el.onclick = onRow;
  }
  function onRow(e) {
    const r = e.target.closest('[data-pl]');
    if (r) { const p = placeList().find(x => x.id === r.dataset.pl); if (p) placeFly(p.lat, p.lng); return; }
    if (e.target.closest('[data-all]')) {
      const b = openSheet('<h2>取過名字的地方</h2><div class="group">' + newest().map(rowHtml).join('') + '</div><button class="btn secondary full press" data-close>關閉</button>');
      b.querySelector('.group').onclick = onRow;
    }
  }
  document.addEventListener('onion:steps', fill);
  const reset = () => { hideAsk(); offered = false; draw(); fill(); };
  document.addEventListener('onion:wiped', reset);
  document.addEventListener('onion:restored', reset);
  document.addEventListener('onion:imported', e => {
    const days = engine.state().days, gone = e.detail.gone || [];
    if (L.markOld(asked(), e.detail.days.filter(k => days[k]).map(k => [days[k].t0 / 1000, days[k].t1 / 1000]), nowSec())) extSave();
    if (ask && gone.includes(dayKey(ask.t0))) { offered = false; hideAsk(); } // 問的那天被收掉了
  });
  hook.ready.push(() => { draw(); setTimeout(maybeAsk, 1500); });
})();
