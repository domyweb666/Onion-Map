function handRect(g, x, y, w, h, jit, seed) { // 手抖的方框：每邊切幾段、每段偏一點；固定 seed，換框重畫時抖法一樣
  let k = seed;
  const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * jit;
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  g.beginPath(); g.moveTo(x + rnd(), y + rnd());
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1], [bx, by] = corners[i], steps = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 60));
    for (let s = 1; s <= steps; s++) g.lineTo(ax + (bx - ax) * s / steps + rnd(), ay + (by - ay) * s / steps + rnd());
  }
  g.stroke();
}
function cartouche(g, x, y, w, h, seed) { // 字底下的紙片：半透明紙＋外粗內細兩道墨線
  g.save(); g.fillStyle = 'rgba(246,238,219,.95)'; g.shadowColor = 'rgba(30,22,12,.4)'; g.shadowBlur = 12; g.shadowOffsetY = 3; g.fillRect(x, y, w, h); g.restore();
  g.strokeStyle = '#2B241C'; g.lineWidth = 3; handRect(g, x, y, w, h, 1.1, seed);
  g.strokeStyle = 'rgba(43,36,28,.7)'; g.lineWidth = 1.4; handRect(g, x + 7, y + 7, w - 14, h - 14, 0.7, seed + 7);
}
function haloText(g, text, x, y) { g.lineWidth = 5; g.strokeStyle = 'rgba(28,24,18,.85)'; g.strokeText(text, x, y); g.fillStyle = '#F6EEDB'; g.fillText(text, x, y); }

function drawCardUI(g, o) {
  const U = CARD_UI, pad = 32;
  g.textBaseline = 'alphabetic';
  // 標題帶：左上。地名／稱號（紅）／被看穿的理由／日期
  const fT = '900 50px ' + CARD_SERIF, fB2 = '900 34px ' + CARD_SERIF, fW = '400 22px ' + CARD_KAI, fS = '400 21px ' + CARD_KAI;
  const badge = '〔' + o.badge.name + '〕';
  g.font = fT; const tw = g.measureText(o.title).width; g.font = fB2; const bw2 = g.measureText(badge).width;
  g.font = fW; const ww2 = g.measureText(o.badge.why).width; g.font = fS; const sw = g.measureText(o.sub).width;
  const bw = Math.ceil(Math.max(tw, bw2, ww2, sw) + pad * 2), bh = 222;
  cartouche(g, U.l, U.t, bw, bh, 11);
  g.font = fT; g.fillStyle = '#2B241C'; g.fillText(o.title, U.l + pad, U.t + 74);
  g.font = fB2; g.fillStyle = '#A33028'; g.fillText(badge, U.l + pad - 14, U.t + 124);
  g.font = fW; g.fillStyle = '#2B241C'; g.fillText(o.badge.why, U.l + pad + 2, U.t + 158);
  g.font = fS; g.fillStyle = '#5A4E3F'; g.fillText(o.sub, U.l + pad + 2, U.t + 194);
  // 統計板：右下。大數字是「這一區你走過多少」，有一點自嘲才有人想分享；找不到行政區（海上、資料沒載到）就退回「這張圖裡」
  const pctText = fmtPct(o.pct), l1 = o.label, l3 = o.line3;
  const fB = '700 60px ' + CARD_SERIF, fL = '400 23px ' + CARD_KAI;
  g.font = fL; const w1 = g.measureText(l1).width, w3 = g.measureText(l3).width; g.font = fB; const w2 = g.measureText(pctText).width;
  const sw2 = Math.ceil(Math.max(w1, w2, w3) + pad * 2), sh2 = 190, sx2 = U.r - sw2, sy2 = U.b - sh2;
  cartouche(g, sx2, sy2, sw2, sh2, 23);
  g.font = fL; g.fillStyle = '#5A4E3F'; g.fillText(l1, sx2 + pad, sy2 + 52);
  g.font = fB; g.fillStyle = '#A33028'; g.fillText(pctText, sx2 + pad - 2, sy2 + 118);
  g.font = fL; g.fillStyle = '#2B241C'; g.fillText(l3, sx2 + pad, sy2 + 160);
  // 比例尺：統計板正上方，靠右；霧上也看得到（紙色字、深色描邊）
  const L = [20000, 10000, 5000, 2000, 1000, 500, 250, 100, 50, 20].find(v => v / o.mpp <= 240) || 20;
  const bl = L / o.mpp, bx = U.r - bl, by = sy2 - 28;
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#F6EEDB' : '#2B241C'; g.fillRect(bx + bl * i / 4, by, bl / 4, 12); }
  g.lineWidth = 2; g.strokeStyle = '#F6EEDB'; g.strokeRect(bx, by, bl, 12);
  g.font = '400 22px ' + CARD_KAI; haloText(g, '0', bx - 6, by - 10);
  const lab = L >= 1000 ? (L / 1000) + ' km' : L + ' m'; haloText(g, lab, U.r - g.measureText(lab).width, by - 10);
  // 底邊署名
  g.font = '400 20px ' + CARD_SERIF; g.fillStyle = 'rgba(74,47,24,.85)'; const sig = 'ONION MAP · 洋蔥地圖';
  g.fillText(sig, (CARD_W - g.measureText(sig).width) / 2, CARD_H - 22);
}

async function drawCard() {
  const my = ++card.tok, snap = card.snap, v = card.view;
  let fr; try { fr = await loadFrame(card.frame); } catch (e) { toast(e.message); return; }
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  if (my !== card.tok) return; // 連續點了好幾個框，只畫最後一個
  const g = $('cardCanvas').getContext('2d'), [l, t, r, b] = fr.win, ww = r - l, wh = b - t;
  const s = Math.max(ww / snap.width, wh / snap.height), sw = ww / s, sh = wh / s, sx = (snap.width - sw) / 2, sy = (snap.height - sh) / 2;
  g.fillStyle = '#F4EEE0'; g.fillRect(0, 0, CARD_W, CARD_H);
  g.drawImage(snap, sx, sy, sw, sh, l, t, ww, wh);
  g.drawImage(fr.canvas, 0, 0);
  const dpr = snap.width / v.w, nw = v.at(sx / dpr, sy / dpr), se = v.at((sx + sw) / dpr, (sy + sh) / dpr), mid = v.at((sx + sw / 2) / dpr, (sy + sh / 2) / dpr);
  const st = engine.state(), d = new Date(), pad2 = x => String(x).padStart(2, '0');
  const areaText = '已開拓 ' + (st.area < 10 ? st.area.toFixed(2) : st.area.toFixed(1)) + ' km²';
  let title = v.title, label, pct, line3;
  let adm = null; try { adm = await loadAdmin(); } catch (e) {}
  if (my !== card.tok) return;
  const town = adm && townAt(adm, mid.lng, mid.lat);
  if (town) { // 框住的那塊中心落在哪一區，就報那一區；底下再報整個縣市
    const ex = exploredByTown(adm), cty = adm.counties[town.c];
    title = cty.n + '・' + town.n;
    label = town.n + '，你走過'; pct = (ex.town.get(town) || 0) / town.a * 100;
    line3 = cty.n + ' ' + fmtPct((ex.county.get(town.c) || 0) / cty.a * 100) + '　' + areaText;
  } else {
    const ex = exploredIn(nw.lng, se.lat, se.lng, nw.lat);
    label = '這張圖裡，你走過'; pct = ex.area > 0 ? ex.explored / ex.area * 100 : 0;
    line3 = areaText + '　地面 ' + Math.round(st.km.walk + st.km.vehicle) + ' km';
  }
  drawCardUI(g, {
    title, label, pct, line3, badge: titleOf(),
    sub: d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + '　走過 ' + daysWalked() + ' 天',
    mpp: v.mpp / (dpr * s)
  });
}

function markStrip() { for (const b of $('frameStrip').children) b.classList.toggle('on', b.dataset.id === card.frame); }
function buildStrip() {
  const el = $('frameStrip');
  if (!el.childElementCount) for (const f of FRAMES) {
    const b = document.createElement('button'); b.className = 'fr press'; b.dataset.id = f.id; b.setAttribute('aria-label', '換成' + f.name + '框');
    b.innerHTML = '<img src="assets/frames/' + f.id + '.png" alt=""><span>' + f.name + '</span>';
    b.onclick = () => { card.frame = f.id; try { localStorage.setItem(FRAME_KEY, f.id); } catch (e) {} markStrip(); drawCard(); };
    el.appendChild(b);
  }
  markStrip();
}

async function enterCard() {
  const s = engine.state(), none = !Object.keys(s.cells).length;
  $('cardEmpty').hidden = !none; $('cardMain').hidden = none;
  if (none) return;
  card.snap = await snapMap(); card.view = viewNow();
  buildStrip();
  FRAMES.forEach(f => loadFrame(f.id).catch(() => {})); // 其他框先在背景處理好，換的時候不用等
  loadAdmin().catch(() => {});
  drawCard();
};
$('btnCardClose').onclick = () => go('map');
$('btnCardShare').onclick = async () => {
  const cv = $('cardCanvas'), name = 'onion-card-' + new Date().toISOString().slice(0, 10) + '.png';
  if (NATIVE) { // 跟匯出備份同一招：寫進暫存資料夾，再開 iOS 分享面板（存相簿、傳 LINE、發 IG 都從這裡）
    try {
      await FS.writeFile({ path: name, data: cv.toDataURL('image/png').split(',')[1], directory: 'CACHE' });
      const { uri } = await FS.getUri({ path: name, directory: 'CACHE' });
      await SHARE.share({ title: '我的洋蔥地圖', url: uri });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('分享失敗：' + (e.message || e)); }
    return;
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/png')), file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: '我的洋蔥地圖' }); } catch (e) {} return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

