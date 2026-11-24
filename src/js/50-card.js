// ===== 製圖：把現在看到的迷霧地圖截下來，放進多米用 AI 產的框，壓上固定位置的 UI 層；可換框、可分享 =====
// 框在 assets/frames/（離線卡片 tools/daycard 用同一批）。UI 層的位置跟 daycard.py 的 UI_* 是同一組數字：不管哪款框都一樣
const CARD_W = 1080, CARD_H = 1620, CARD_UI = { l: 110, t: 200, r: 970, b: 1420 };
const FRAMES = [
  { id: 'vine-watercolor', name: '水彩花藤' },
  { id: 'flowers', name: '花卉卷軸' },
  { id: 'vine-wrap', name: '花藤環繞' },
  { id: 'castle', name: '城堡' }
];
const FRAME_KEY = 'onion.frame';
const CARD_SERIF = "'Noto Serif TC','Source Han Serif TC','Songti TC','STSong','PMingLiU',serif"; // 標題：宋體粗（rpg 字體方案）
const CARD_KAI = "'LXGW WenKai TC','LXGW WenKai','Kaiti TC','STKaiti','DFKai-SB','BiauKai',serif"; // 內文：楷體
const card = { frame: null, snap: null, view: null, tok: 0 };
try { card.frame = localStorage.getItem(FRAME_KEY); } catch (e) {}
if (!FRAMES.some(f => f.id === card.frame)) card.frame = FRAMES[0].id;

const frameCache = {};
function loadFrame(id) { // 框縮到卡片大小、找出中間透明的窗、窗內緣的米色暈改成焦褐陰影（跟 tools/daycard/overlay_frame.py 同一套）
  if (frameCache[id]) return frameCache[id];
  return frameCache[id] = new Promise((ok, bad) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, CARD_W, CARD_H);
      const img = g.getImageData(0, 0, CARD_W, CARD_H), d = img.data, n = CARD_W * CARD_H;
      const seen = new Uint8Array(n), q = new Int32Array(n), start = (CARD_H >> 1) * CARD_W + (CARD_W >> 1);
      let head = 0, tail = 0, l = CARD_W, t = CARD_H, r = 0, b = 0;
      const push = p => { if (!seen[p] && d[p * 4 + 3] < 250) { seen[p] = 1; q[tail++] = p; } };
      push(start);
      while (head < tail) { // 從中心沿著 alpha 低的像素往外長，長到的範圍就是窗
        const p = q[head++], x = p % CARD_W, y = (p / CARD_W) | 0;
        if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
        const a = d[p * 4 + 3];
        if (a > 0) { d[p * 4] = 58; d[p * 4 + 1] = 40; d[p * 4 + 2] = 24; d[p * 4 + 3] = a * 0.7; } // 黑霧貼著框，不留白邊
        if (x > 0) push(p - 1); if (x < CARD_W - 1) push(p + 1); if (y > 0) push(p - CARD_W); if (y < CARD_H - 1) push(p + CARD_W);
      }
      if (!tail) { l = 60; t = 60; r = CARD_W - 61; b = CARD_H - 61; } // 中心不透明：這張不像框，就整張蓋上去
      g.putImageData(img, 0, 0);
      ok({ canvas: c, win: [l, t, r + 1, b + 1] });
    };
    im.onerror = () => { delete frameCache[id]; bad(new Error('框載不到：' + id)); };
    im.src = 'assets/frames/' + id + '.png';
  });
}

function snapMap() { // WebGL 畫布要在 render 那一刻讀，不然是空的
  return new Promise(ok => {
    let done = false;
    const grab = () => {
      if (done) return; done = true;
      const src = map.getCanvas(), c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const g = c.getContext('2d'); g.drawImage(src, 0, 0);
      ok(c);
    };
    map.once('render', grab); map.triggerRepaint();
    setTimeout(() => { if (!done) { try { map._render(performance.now()); } catch (e) {} grab(); } }, 800); // 背景分頁沒有 rAF 時的保險
  });
}

function viewNow() { // 記下按「製圖」那一刻的鏡頭：之後換框要重算範圍，地圖若在背景跟著定位移動也不影響
  const el = map.getContainer(), c = map.getCenter(), z = map.getZoom(), size = 512 * Math.pow(2, z);
  const merc = (lng, lat) => { const s = Math.sin(lat * Math.PI / 180); return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size]; };
  const [cx, cy] = merc(c.lng, c.lat), w = el.clientWidth, h = el.clientHeight;
  const at = (x, y) => { const X = cx + x - w / 2, Y = cy + y - h / 2, m = 0.5 - Y / size; return { lng: X / size * 360 - 180, lat: 90 - 360 * Math.atan(Math.exp(-m * 2 * Math.PI)) / Math.PI }; };
  return { w, h, at, mpp: 40075016.686 * Math.cos(c.lat * Math.PI / 180) / size, title: placeTitle(c, z) };
}

function placeTitle(c, z) { // 卡片標題：畫面中心最近的城市與區（圖磚裡的地名點）；拉得太遠或圖磚沒載就叫「洋蔥地圖」
  if (z < 8.5) return '洋蔥地圖';
  let feats = []; try { feats = map.querySourceFeatures('omt', { sourceLayer: 'place' }); } catch (e) {}
  const k = Math.cos(c.lat * Math.PI / 180);
  const near = classes => {
    let best = null, bd = Infinity;
    for (const f of feats) {
      if (!classes.includes(f.properties.class) || f.geometry.type !== 'Point') continue;
      const [x, y] = f.geometry.coordinates, dd = ((x - c.lng) * k) ** 2 + (y - c.lat) ** 2;
      if (dd < bd) { bd = dd; best = f; }
    }
    return best ? (best.properties['name:zh-Hant'] || best.properties['name:zh'] || best.properties.name) : null;
  };
  const city = near(['city', 'town']), sub = z >= 12 ? near(['suburb', 'quarter']) : null;
  return [city, sub].filter(Boolean).join('・') || '洋蔥地圖';
}

function exploredIn(w, s, e, n) { // 範圍內探索過的面積（格子中心落在範圍裡就算）與範圍面積，km²
  const cells = engine.state().cells; let a = 0;
  for (const c in cells) { const [lat, lng] = h3.cellToLatLng(c); if (lng >= w && lng <= e && lat >= s && lat <= n) a += h3.cellArea(c, 'km2'); }
  return { explored: a, area: (e - w) * 111.32 * Math.cos((s + n) / 2 * Math.PI / 180) * (n - s) * 110.57 };
}

function daysWalked(P) {
  if (!P) return Object.keys(engine.state().days).length;
  const days = new Set();
  for (const p of P) { const t = p[0] < 1e12 ? p[0] * 1000 : p[0]; days.add(new Date(t).toDateString()); }
  return days.size;
}

// --- 稱號：看軌跡的樣子給一個身分，外加一句「被看穿」的理由。只用這支手機裡的資料，不跟別人比 ---
// 判斷照順序，第一個符合的就是；每一條的門檻都寫在這裡，要調直接改數字
function profileOf(s = engine.state()) { // s 可以是任何一個引擎的 state（例如只餵一週的紀錄），用來檢查稱號會不會每週都一樣
  const P = s.points, n = P.length, ground = s.km.walk + s.km.vehicle;
  let night = 0, early = 0, la = 0, ln = 0;
  for (const p of P) {
    const h = new Date((p[0] < 1e12 ? p[0] * 1000 : p[0])).getHours();
    if (h >= 22 || h < 4) night++; else if (h >= 5 && h < 8) early++;
    la += p[1]; ln += p[2];
  }
  la /= n || 1; ln /= n || 1;
  let rg = 0; const k = Math.cos(la * Math.PI / 180); // 迴轉半徑：軌跡點離重心的均方根距離（公里）。只拿來算半徑，重心本身不顯示，免得把家畫出來
  for (const p of P) rg += ((p[2] - ln) * 111.32 * k) ** 2 + ((p[1] - la) * 110.57) ** 2;
  rg = Math.sqrt(rg / (n || 1));
  const cells = Object.values(s.cells), once = cells.filter(c => c[0] <= 1).length, thrice = cells.filter(c => c[0] >= 3).length;
  return { n, ground, walk: s.km.walk, vehicle: s.km.vehicle, flights: s.flights.length, night: night / (n || 1), early: early / (n || 1),
    rg, days: Object.keys(s.days).length, vdays: daysWalked(P.filter(p => p[4] === 'v')), once: once / (cells.length || 1), thrice: thrice / (cells.length || 1) };
}
const pc = x => Math.round(x * 100) + '%';
const TITLES = [
  { name: '剛出發的旅人', when: p => p.ground < 2, why: p => '地圖才刮開一角' },
  { name: '跨海的候鳥', when: p => p.flights >= 2, why: p => '飛了 ' + p.flights + ' 段航線' },
  // 看「幾天有坐車」比看里程準：走路的里程會被 GPS 抖動灌水，通勤族天天坐車才是特徵（假資料試出來的，2026-11-08）
  { name: '軌道通勤族', when: p => p.days >= 3 && p.vdays >= 0.5 * p.days && p.vehicle >= 0.4 * p.ground, why: p => p.days + ' 天裡有 ' + p.vdays + ' 天在坐車' },
  { name: '夜行者', when: p => p.n >= 200 && p.night >= 0.3, why: p => pc(p.night) + ' 的足跡在晚上十點以後' },
  { name: '早起的鳥', when: p => p.n >= 200 && p.early >= 0.3, why: p => pc(p.early) + ' 的足跡在早上八點以前' },
  { name: '以家為圓心的人', when: p => p.days >= 3 && p.rg < 1.5, why: p => p.days + ' 天都在 ' + p.rg.toFixed(1) + ' 公里內打轉' },
  { name: '遠行者', when: p => p.rg >= 20, why: p => '足跡散在方圓 ' + Math.round(p.rg) + ' 公里' },
  { name: '老路的守護者', when: p => p.days >= 3 && p.thrice >= 0.5, why: p => pc(p.thrice) + ' 的路走過三次以上' },
  { name: '巷弄探子', when: p => p.walk >= 0.7 * p.ground && p.once >= 0.8 && p.rg >= 0.8, why: p => pc(p.once) + ' 的地方只去過一次' }, // 在家門口繞不算探巷子
  { name: '散步家', when: p => true, why: p => '平均一天走 ' + (p.walk / (p.days || 1)).toFixed(1) + ' 公里' }
];
function titleOf(s) { const p = profileOf(s), t = TITLES.find(t => t.when(p)); return { name: t.name, why: t.why(p) }; }

