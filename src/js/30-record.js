// --- 處理一個定位點（真實 GPS 與模擬共用同一條路） ---
const MODE_LABEL = { walk: '步行', vehicle: '車／火車', flight: '飛行' };
let follow = true, zoomIn = false, flyUntil = 0; // zoomIn：開始記錄後第一個點要拉近；flyUntil：定位鈕的動畫跑完前，跟隨先不動地圖
function feed(f, quiet) {
  const r = engine.process(f);
  if (r.ok) {
    showMe(f.lng, f.lat);
    if (follow && r.mode !== 'flight' && performance.now() > flyUntil) {
      if (zoomIn && map.getZoom() < 14) { flyUntil = performance.now() + 1300; map.easeTo({ center: [f.lng, f.lat], zoom: 15, duration: 1200 }); }
      else map.easeTo({ center: [f.lng, f.lat], duration: quiet ? 0 : 600 });
      zoomIn = false;
    }
    if (r.mode === 'flight') { map.fitBounds(flightBounds(), { padding: 80, duration: 1200 }); toast('偵測到飛行，畫上一段航線'); }
    setStatus(MODE_LABEL[r.mode] + ' · ' + Math.round(r.kmh || 0) + ' km/h · 精度 ' + Math.round(f.acc) + 'm');
    saveSoon(); renderSoon(); hook.fix.forEach(fn => { try { fn(f, r, quiet); } catch (e) { console.error(e); } });
  } else setStatus(r.why);
  return r;
}
function flightBounds() {
  const f = engine.state().flights.slice(-1)[0], b = new maplibregl.LngLatBounds();
  arc([f[0], f[1]], [f[2], f[3]]).forEach(p => b.extend(p)); return b;
}
function setStatus(t) { $('status').textContent = t; }
map.on('dragstart', () => { follow = false; });

// --- 真實 GPS ---
// iOS app：走原生 CoreLocation（背景、螢幕關掉都繼續）；網頁：navigator.geolocation，要保持螢幕開啟。
let watchId = null, bgWatcher = null, wakeLock = null;
async function lockScreen() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (recording && !NATIVE) lockScreen(); render(true); }
  else if (recording) flushSave();
});
function setRecUI(on) {
  const b = $('btnRec'); b.classList.toggle('rec', on); b.setAttribute('aria-label', on ? '停止記錄' : '開始記錄');
  $('recTitle').textContent = on ? '記錄中' : '沒在記錄';
  $('recState').textContent = on ? '記錄中' : '沒在記錄';
  if (!on) $('btnSettings').hidden = true;
}
function onFix(lat, lng, acc, t, spd) {
  feed({ lat, lng, acc, t: t || Date.now(), spd: (typeof spd === 'number' && !isNaN(spd)) ? spd : null });
}
async function startRec() {
  if (recording) return;
  await restored; // 舊紀錄讀完才開始記，不然先記的會被蓋掉
  if (recording) return;
  if (simOn) toggleSim();
  engine.resetLast(); follow = true; zoomIn = true;
  if (NATIVE) {
    try {
      bgWatcher = await BG.addWatcher({
        backgroundMessage: '洋蔥正在記錄你走過的地方', // iOS 要有這個欄位才會開背景定位（文字本身只有 Android 用到）
        backgroundTitle: '洋蔥',
        requestPermissions: true,
        stale: false,
        distanceFilter: 4
      }, (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') { setStatus('沒有定位權限，洋蔥畫不了地圖'); $('btnSettings').hidden = false; }
          else setStatus('暫時拿不到定位，持續嘗試中…');
          return;
        }
        onFix(loc.latitude, loc.longitude, loc.accuracy, loc.time, loc.speed);
      });
    } catch (e) { setStatus('無法啟動定位：' + (e.message || e)); return; }
  } else {
    if (!('geolocation' in navigator)) { toast('這個瀏覽器不支援定位'); return; }
    watchId = navigator.geolocation.watchPosition(p => {
      onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp, p.coords.speed);
    }, e => {
      setStatus(e.code === 1 ? '沒有定位權限：請到 設定 › Safari › 位置 允許' : '暫時拿不到定位，持續嘗試中…');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    lockScreen();
  }
  recording = true; hook.rec.forEach(fn => fn(true));
  try { localStorage.setItem(REC_FLAG, '1'); } catch (e) {}
  setRecUI(true); setStatus('等待定位中…');
}
async function stopRec() {
  if (!recording) return;
  recording = false; hook.rec.forEach(fn => fn(false));
  try { localStorage.removeItem(REC_FLAG); } catch (e) {}
  if (NATIVE) { if (bgWatcher) { try { await BG.removeWatcher({ id: bgWatcher }); } catch (e) {} } bgWatcher = null; }
  else {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null;
  }
  setRecUI(false); setStatus('已停止記錄'); flushSave();
}
$('btnRec').onclick = () => recording ? stopRec() : startRec();
$('btnSettings').onclick = () => { if (BG) BG.openSettings(); };
if (NATIVE) {
  $('note').textContent = 'iOS 會在記錄一陣子後問你要不要改成「永遠允許」位置，選它，手機收進口袋也會繼續畫。資料只存在這支手機。';
  $('btnExport').querySelector('.lbl').textContent = '匯出備份';
  $('btnPerm').hidden = false; $('btnPerm').onclick = () => BG.openSettings();
  // 模擬模式只給開發測試，正式版藏起來（網址加 ?dev=1 才出現）
  if (!/[?&]dev=1/.test(location.search)) $('secSim').hidden = true;
  // 上次關掉 app 前還在記錄的話，打開就自動接著記（網頁版不這樣做，避免一開網頁就跳權限視窗）
  let resume = false; try { resume = localStorage.getItem(REC_FLAG) === '1'; } catch (e) {}
  if (resume) restored.then(() => startRec());
}
$('btnLocate').onclick = () => {
  follow = true;
  if (meShown) { flyUntil = performance.now() + 1700; map.flyTo({ center: me.getLngLat(), zoom: Math.max(map.getZoom(), 15), duration: 1500 }); return; }
  navigator.geolocation && navigator.geolocation.getCurrentPosition(
    p => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }),
    () => toast('拿不到定位'), { enableHighAccuracy: true, timeout: 10000 });
};

// --- 模擬模式：在桌上點地圖測試 ---
const SIM = { walk: { kmh: 5, every: 4 }, car: { kmh: 50, every: 3 }, hsr: { kmh: 280, every: 5 }, plane: { kmh: 800 } };
let simOn = false, simMode = 'walk', simPos = null, simClock = 0, simQueue = [], simTimer = null;
function toggleSim() {
  simOn = !simOn;
  $('btnSim').setAttribute('aria-checked', simOn); $('simbar').hidden = !simOn;
  if (simOn) { if (recording) stopRec(); simPos = null; engine.resetLast(); setStatus('模擬模式：點地圖'); }
  else { clearInterval(simTimer); simTimer = null; simQueue = []; engine.resetLast(); setStatus('已離開模擬模式'); }
}
$('btnSim').onclick = () => { toggleSim(); if (simOn) { go('map'); toast('模擬模式：點地圖放下起點'); } };
document.querySelectorAll('#simbar .seg button').forEach(b => b.onclick = () => {
  simMode = b.dataset.m;
  document.querySelectorAll('#simbar .seg button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  if (simMode === 'plane') toast('飛機：請點 50 公里以外的地方');
});
function dist(a, b) { return h3.greatCircleDistance([a.lat, a.lng], [b.lat, b.lng], 'm'); }
map.on('click', e => {
  if (!simOn) return;
  const to = { lat: e.lngLat.lat, lng: e.lngLat.lng };
  follow = true;
  if (!simPos) {
    simClock = Date.now(); simPos = to;
    feed({ ...to, acc: 5, t: simClock, spd: 0 }); return;
  }
  simQueue = []; const cfg = SIM[simMode], d = dist(simPos, to);
  if (simMode === 'plane') {
    if (d < 50000) { toast('距離太近（' + (d / 1000).toFixed(1) + ' km），飛機請點 50 公里以外'); return; }
    simClock += d / (cfg.kmh / 3.6) * 1000;
    simQueue.push({ ...to, acc: 10, t: simClock, spd: cfg.kmh / 3.6 });
  } else {
    const step = cfg.kmh / 3.6 * cfg.every, n = Math.max(1, Math.ceil(d / step)), from = simPos;
    for (let i = 1; i <= n; i++) {
      const f = i / n; simClock += cfg.every * 1000 * (i === n ? (d - step * (n - 1)) / step : 1);
      simQueue.push({ lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f,
        acc: 6 + Math.random() * 6, t: simClock, spd: cfg.kmh / 3.6 });
    }
  }
  if (!simTimer) simTimer = setInterval(() => {
    const per = Math.max(1, Math.ceil(simQueue.length / 120));
    for (let i = 0; i < per && simQueue.length; i++) { const f = simQueue.shift(); simPos = { lat: f.lat, lng: f.lng }; feed(f, true); }
    if (!simQueue.length) { clearInterval(simTimer); simTimer = null; render(); }
  }, 30);
});
