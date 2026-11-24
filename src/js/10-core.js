// ===== 以下是畫面與地圖 =====
if (typeof h3 === 'undefined' || typeof maplibregl === 'undefined') {
  document.getElementById('status').textContent = '程式庫載入失敗，請重新整理頁面';
  throw new Error('libs missing');
}
// 測試用：背景分頁（自動化截圖）不會跑 requestAnimationFrame，網址加 ?testrender=1 改用計時器驅動 MapLibre
if (/[?&]testrender=1/.test(location.search)) {
  window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = id => clearTimeout(id);
}
const STORE = 'yangcong.v1';
const engine = createEngine(h3);
const $ = id => document.getElementById(id);

// --- 平台：在 iOS app（Capacitor）裡走原生 plugin；在瀏覽器裡維持原本的網頁作法 ---
const CapX = typeof capacitorExports !== 'undefined' ? capacitorExports : null;
const NATIVE = !!(CapX && CapX.Capacitor && CapX.Capacitor.isNativePlatform());
const BG = NATIVE ? CapX.registerPlugin('BackgroundGeolocation') : null; // 背景定位（CoreLocation）
const FS = NATIVE ? CapX.registerPlugin('Filesystem') : null;            // 檔案（Documents 會跟著 iCloud 手機備份）
const SHARE = NATIVE ? CapX.registerPlugin('Share') : null;              // iOS 分享面板（匯出備份用）
const DATA_FILE = 'onion-map.json';
const REC_FLAG = 'yangcong.recording';
let recording = false;

function toast(msg, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// --- 給各模組掛的地方 ---
// hook.fix：每收到一個有效定位點 (f, r, quiet)；hook.rec：開始／停止記錄 (on)；hook.tab：換分頁 (tab)；hook.ready：舊紀錄讀完、地圖載好
const hook = { fix: [], rec: [], tab: [], ready: [] };
const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// --- 共用底部抽屜 ---
function openSheet(html) { $('sheetBody').innerHTML = html; $('sheetHost').hidden = false; $('sheetBody').scrollTop = 0; return $('sheetBody'); }
function closeSheet() { $('sheetHost').hidden = true; $('sheetBody').innerHTML = ''; document.dispatchEvent(new Event('onion:sheetclosed')); }
// 鍵盤跳出來時，抽屜縮到鍵盤上面那一塊。不縮的話 iOS 會把整頁往上推，標題鑽到瀏海底下、按鈕藏在鍵盤後面
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const host = $('sheetHost'), kb = !host.hidden && innerHeight - vv.height > 120;
    if (kb === host.classList.contains('kb') && !kb) return;
    host.classList.toggle('kb', kb); host.style.top = kb ? vv.offsetTop + 'px' : ''; host.style.setProperty('--kb', kb ? innerHeight - vv.height + 'px' : '0px');
    const a = document.activeElement;
    if (kb && a && $('sheetBody').contains(a)) a.scrollIntoView({ block: 'nearest' });
    if (!kb && window.scrollY) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
  document.addEventListener('onion:sheetclosed', fit);
}
$('sheetHost').onclick = e => { if (e.target === $('sheetHost') || e.target.closest('[data-close]')) closeSheet(); };
