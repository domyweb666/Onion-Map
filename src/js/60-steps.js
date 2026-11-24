// ===== 足跡：每天一列。從軌跡點算，跟引擎記里程的規則一樣（間隔太久、跳太遠的兩點不連線） =====
const WEEKDAY = '日一二三四五六';
function dayLog() { // 新的在前。key 是 'YYYY-MM-DD'，拿去 loadDay(key) 讀那天的點
  return Object.entries(engine.state().days).map(([key, d]) => {
    const [y, m, dd] = key.split('-').map(Number);
    return { key, date: new Date(y, m - 1, dd), t0: d.t0, t1: d.t1, walk: d.walk, veh: d.veh, fl: d.fl, w: d.box[0], s: d.box[1], e: d.box[2], n: d.box[3] };
  }).sort((a, b) => b.date - a.date);
}
function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function dayGroup(d) {
  const w0 = weekStart(new Date()), w = weekStart(d);
  if (+w === +w0) return '這週';
  if (w0 - w <= 7 * 864e5 + 36e5) return '上週';
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月';
}
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function kmText(km) { return km >= 10 ? Math.round(km) + ' km' : km >= 1 ? km.toFixed(1) + ' km' : Math.round(km * 1000) + ' m'; } // 不到一公里用公尺，免得走了半天還寫 0 km
let stepDays = [];
function renderSteps() {
  const st = engine.state(), el = $('stepsBody');
  stepDays = dayLog();
  if (!stepDays.length) {
    el.innerHTML = '<div class="empty"><div class="badge"><svg class="ic"><use href="#i-route"/></svg></div>' +
      '<h3>還沒有足跡</h3><p>開始記錄之後，每天走過的路會一天一列排在這裡。</p>' +
      '<button class="btn primary compact press" data-go="map">去地圖開始記錄</button></div>';
    return;
  }
  const area = st.area < 10 ? st.area.toFixed(2) : st.area.toFixed(1), t = titleOf(), ground = kmText(st.km.walk + st.km.vehicle).split(' ');
  let h = '<div class="statgrid">' +
    '<div><b>' + area + '<small> km²</small></b><span>已探索</span></div>' +
    '<div><b>' + ground[0] + '<small> ' + ground[1] + '</small></b><span>地面里程</span></div>' +
    '<div><b>' + stepDays.length + '<small> 天</small></b><span>有出門</span></div>' +
    '<div><b>' + st.flights.length + '<small> 段</small></b><span>航線</span></div></div>' +
    '<div class="section"><h2>稱號</h2><div class="group"><div class="row"><div class="lines">' +
    '<span class="ttl">' + esc(t.name) + '</span><span class="meta">' + esc(t.why) + '</span></div></div></div></div>';
  h += '<div id="mountStamps"></div><div id="mountPlaces"></div>';
  let group = null;
  stepDays.forEach((d, i) => {
    const g = dayGroup(d.date);
    if (g !== group) { if (group) h += '</div></div>'; group = g; h += '<div class="section"><h2>' + g + '</h2><div class="group">'; }
    const parts = [];
    if (d.walk >= 0.05) parts.push('走 ' + kmText(d.walk));
    if (d.veh >= 0.05) parts.push('坐車 ' + kmText(d.veh));
    if (d.fl) parts.push('飛 ' + d.fl + ' 段');
    const meta = (d.date.getMonth() + 1) + '/' + d.date.getDate() + ' 週' + WEEKDAY[d.date.getDay()] + ' · ' + hm(d.t0) + (d.t1 - d.t0 > 6e4 ? '–' + hm(d.t1) : '');
    h += '<button class="row" data-day="' + i + '"><div class="lines"><span class="meta">' + meta + '</span><span class="ttl">' +
      (parts.join(' · ') || '在原地附近') + '</span></div><svg class="chev"><use href="#i-chev"/></svg></button>';
  });
  el.innerHTML = h + '</div></div><p class="foot">點一天，地圖會飛到那天走過的範圍。</p>';
  document.dispatchEvent(new Event('onion:steps')); // 其他模組（印章、地點）在這裡把自己的區塊補進去
}
$('stepsBody').onclick = e => {
  const b = e.target.closest('[data-day]'); if (!b) return;
  const d = stepDays[+b.dataset.day]; follow = false; go('map');
  map.fitBounds([[d.w, d.s], [d.e, d.n]], { padding: { top: 90, bottom: 260, left: 40, right: 80 }, maxZoom: 16, duration: 900 });
};

