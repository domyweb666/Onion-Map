// ===== iOS 原生：掃 QR、小工具、鎖定畫面的即時動態（ios/App/App/OnionNativePlugin.swift）。網頁上整份不動作 =====
// 用 var：別的檔排在前面也讀得到這個名字（還沒跑到這行是 undefined，不會炸）。要用的時候再讀，不要在檔案最外層讀
// 注意它是 Capacitor 的代理物件，不要直接 await NATIVE_ONION
var NATIVE_ONION = NATIVE ? CapX.registerPlugin('OnionNative') : null;
(() => {
  if (!NATIVE_ONION) return;
  const ask = (name, arg) => { try { return Promise.resolve(NATIVE_ONION[name](arg || {})).catch(() => null); } catch (e) { return Promise.resolve(null); } };

  // --- 這一趟：按下開始記錄之後的里程與新面積。存起來，app 被系統關掉再開也接得回來 ---
  const TRIP_KEY = 'onion.trip', TRIP_MAX = 12 * 3600e3;
  let trip = null, mode = 'walk', sentAt = 0, sentKm = 0;
  let resuming = false; // 打開時上次還在記：接同一趟
  try { resuming = localStorage.getItem(REC_FLAG) === '1'; } catch (e) {}
  const ground = () => { const k = engine.state().km; return k.walk + k.vehicle; };
  const saveTrip = () => { try { trip ? localStorage.setItem(TRIP_KEY, JSON.stringify(trip)) : localStorage.removeItem(TRIP_KEY); } catch (e) {} };
  function openTrip() {
    let old = null;
    if (resuming) { try { old = JSON.parse(localStorage.getItem(TRIP_KEY)); } catch (e) {} }
    resuming = false;
    trip = old && old.t > 0 && Date.now() - old.t < TRIP_MAX ? old : { t: Date.now(), km: ground(), area: engine.state().area };
    saveTrip();
  }
  function tripNow() {
    const km = ground(), area = engine.state().area;
    if (km < trip.km - 1e-6 || area < trip.area - 1e-6) { trip.km = Math.min(trip.km, km); trip.area = Math.min(trip.area, area); saveTrip(); } // 中途清除或還原過紀錄
    return { startedAt: trip.t, km: Math.max(0, km - trip.km), area: Math.max(0, area - trip.area), mode };
  }
  function pushActivity(force) {
    if (!recording || !trip) return;
    const n = tripNow(), dt = Date.now() - sentAt;
    if (!force && (dt < 5000 || (dt < 15000 && n.km - sentKm < 0.05))) return;
    sentAt = Date.now(); sentKm = n.km;
    ask(force ? 'startActivity' : 'updateActivity', n); // startActivity 重複叫沒關係：同一趟還在就接回來
  }

  // --- 小工具 ---
  let loaded = false, lastSig = '', widgetAt = 0, titleText = '', titleAt = 0;
  let thumb = null, thumbSent = null, thumbAt = 0, thumbBusy = false;
  function titleNow() {
    if (!titleText || Date.now() - titleAt > 600e3) { titleAt = Date.now(); try { titleText = Object.keys(engine.state().days).length ? titleOf().name : ''; } catch (e) {} }
    return titleText;
  }
  function pushWidget() {
    if (!loaded || store.locked) return; // 紀錄沒讀完就送，會把小工具蓋成 0
    const st = engine.state(), key = dayKey(Date.now()), d = st.days[key];
    const p = { todayKm: d ? d.walk + d.veh : 0, area: st.area, title: titleNow(), recording };
    const sig = [key, p.todayKm < 1 ? Math.round(p.todayKm * 100) : Math.round(p.todayKm * 10), p.area.toFixed(2), p.title, recording].join('|');
    if (thumb !== thumbSent) p.map = thumb || '';
    widgetAt = Date.now();
    if (sig === lastSig && p.map === undefined) return;
    lastSig = sig; thumbSent = thumb;
    ask('setWidget', p);
  }
  // 縮圖：把現在的迷霧地圖裁成方形。只在看得到畫面時截（背景拿不到 WebGL 的內容），平常留著最後一張
  async function takeThumb() {
    if (thumbBusy || !loaded || document.visibilityState !== 'visible' || Date.now() - thumbAt < 60e3) return;
    if (!engine.state().area || typeof snapMap !== 'function') return;
    thumbBusy = true; thumbAt = Date.now();
    try {
      const src = await snapMap(), n = Math.min(src.width, src.height), S = 360;
      if (n > 0 && document.visibilityState === 'visible') {
        const c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(src, (src.width - n) / 2, (src.height - n) / 2, n, n, 0, 0, S, S);
        const a = g.getImageData(0, 0, S, S).data; let solid = 0;
        for (let i = 3; i < a.length; i += 4 * 997) if (a[i] > 200) solid++;
        if (solid > a.length / (4 * 997) / 2) thumb = c.toDataURL('image/jpeg', 0.8).split(',')[1] || thumb; // 截到空的就沿用上一張
      }
    } catch (e) {}
    thumbBusy = false;
  }

  // --- 接上各個時機 ---
  hook.rec.push(on => {
    try {
      if (on) { openTrip(); mode = 'walk'; pushActivity(true); }
      else { trip = null; saveTrip(); ask('endActivity'); }
      pushWidget();
    } catch (e) { console.error(e); } // 這裡出錯不能擋住記錄
  });
  hook.fix.push((f, r) => {
    if (!recording) return; // 模擬模式不算
    if (r && r.mode) mode = r.mode;
    pushActivity(false);
    if (Date.now() - widgetAt >= 120e3) { widgetAt = Date.now(); takeThumb().then(pushWidget); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pushActivity(true); // 系統最多留八小時，回到前景補開
    else pushWidget();
  });
  map.on('idle', () => { takeThumb(); });
  document.addEventListener('onion:wiped', () => { thumb = null; titleText = ''; if (trip) { trip.km = ground(); trip.area = engine.state().area; saveTrip(); } pushActivity(true); pushWidget(); });
  document.addEventListener('onion:restored', () => { titleText = ''; pushWidget(); });

  if (!resuming) ask('endActivity'); // 上次已經停了，鎖定畫面不能還掛著
  else setTimeout(() => { if (!recording) { ask('endActivity'); pushWidget(); } }, 20e3); // 要接著記但沒接成（例如定位被關）
  restored.then(() => { loaded = true; takeThumb(); pushWidget(); }, () => {});
})();
