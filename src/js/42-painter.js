// ===== 畫圖服務：把底稿送出去，等 ChatGPT 畫好拿回來。電腦上的程式與之後的雲端是同一套介面（docs/模組約定.md） =====
// 配對與等待中的工作存 ext('painter')：{url, token, name, kind, jobs:[{id, kind, key, at}]}。配對密碼不進備份（15-store.js）
// 畫好之後交給 painterOn[kind](job, 'data:image/…') 收（日卡、底圖各自登記），收好才把工作從清單拿掉，再發 document 事件：
//   onion:painted {kind, key, ok, error}　　onion:painter 配對狀態或等待中的工作有變
const PAINT_CLOUD_URL = ''; // 雲端畫圖服務的網址。空的就只有「用電腦的 ChatGPT 畫」
const painterOn = {};
const painterMem = { reach: null, left: null, timer: null, busy: false, live: {}, tries: {}, after: null };

function painterData() {
  const p = ext('painter', { url: '', token: '', name: '', kind: '', jobs: [] });
  if (!Array.isArray(p.jobs)) p.jobs = [];
  return p;
}
function painterChanged() { document.dispatchEvent(new Event('onion:painter')); }
function painterTarget() { // 現在要送去哪裡；null＝還沒配對也沒有雲端
  const p = painterData();
  if (p.url) return { url: p.url, token: p.token, kind: 'pc' };
  if (!PAINT_CLOUD_URL) return null;
  if (!p.device) { // 雲端用一組隨機的裝置代號，不是帳號
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    p.device = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); extSave();
  }
  return { url: PAINT_CLOUD_URL, token: p.device, kind: 'cloud' };
}
// 一次請求。iOS 走原生連線（網頁的連線會被擋：https 頁面連不到區網的 http、也過不了跨來源檢查）
async function painterCall(method, path, body, ms, to) {
  const t = to || painterTarget();
  if (!t) throw new Error('還沒配對電腦');
  const url = t.url.replace(/\/+$/, '') + path, headers = { 'X-Onion-Token': t.token };
  if (body) headers['Content-Type'] = 'application/json';
  const off = () => Object.assign(new Error(t.kind === 'cloud' ? '連不到網路' : '連不到電腦'), { offline: true });
  let status, data;
  if (NATIVE) {
    let r; try { r = await CapX.CapacitorHttp.request({ method, url, headers, data: body || undefined, connectTimeout: 8000, readTimeout: ms || 15000 }); } catch (e) { throw off(); }
    status = r.status; data = r.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = {}; } }
  } else {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms || 15000);
    try {
      const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      status = r.status; data = await r.json().catch(() => ({}));
    } catch (e) { throw off(); } finally { clearTimeout(tm); }
  }
  if (status >= 400) throw Object.assign(new Error((data && data.error) || (status === 401 || status === 403 ? '配對過期了，重新掃一次 QR' : '畫圖那邊出了問題（' + status + '）')), { status });
  return data || {};
}

function painterParse(text) { // onion://pair?u=…&t=…&n=…
  const m = /^\s*onion:\/\/pair\/?\?(\S+)/i.exec(String(text || '')); if (!m) return null;
  const q = {}; for (const kv of m[1].split('&')) { const i = kv.indexOf('='); if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {} } }
  if (!/^https?:\/\/[^\s/]+/i.test(q.u || '') || !q.t) return null;
  return { url: q.u, token: q.t, name: (q.n || '我的電腦').slice(0, 40) };
}
async function painterPair(text) {
  const c = painterParse(text);
  if (!c) throw new Error('這不是洋蔥的配對 QR');
  let r; try { r = await painterCall('GET', '/ping', null, 10000, { url: c.url, token: c.token, kind: 'pc' }); }
  catch (e) { throw e.offline ? new Error('連不到電腦。確認畫圖程式開著，手機跟電腦是同一個 Wi-Fi') : e; }
  const p = painterData();
  if (p.url && p.url !== c.url) painterDropJobs('換了一台電腦');
  p.url = c.url; p.token = c.token; p.name = r.name || c.name; p.kind = r.kind || 'pc';
  painterMem.reach = true; extSave(); flushSave(); painterChanged();
  return { name: p.name };
}
function painterUnpair() {
  const p = painterData(); painterDropJobs('已經解除配對');
  p.url = p.token = p.name = p.kind = ''; painterMem.reach = null; extSave(); painterChanged();
}
async function painterPing() {
  if (!painterTarget()) { painterMem.reach = null; return null; }
  try { const r = await painterCall('GET', '/ping', null, 6000); painterMem.reach = true; painterMem.left = r.left != null ? r.left : null; painterChanged(); return r; }
  catch (e) { painterMem.reach = false; painterChanged(); return null; }
}

// --- 工作 ---
async function painterSubmit(kind, base64, key) {
  const r = await painterCall('POST', '/paint', { kind, style: 'pencil', image: String(base64).replace(/^data:[^,]*,/, '') }, 60000);
  if (!r.id) throw new Error('畫圖那邊沒有收到');
  painterMem.reach = true;
  if (key != null) { painterData().jobs.push({ id: r.id, kind, key, at: Date.now() }); extSave(); flushSave(); painterChanged(); painterSoon(3000); }
  return r.id;
}
function painterPoll(id) { return painterCall('GET', '/paint/' + encodeURIComponent(id), null, 12000); }
async function painterImage(id) {
  const r = await painterCall('GET', '/paint/' + encodeURIComponent(id) + '/image', null, 60000);
  if (!r.image) throw new Error('圖沒有傳回來');
  return 'data:' + (r.mime || 'image/png') + ';base64,' + r.image;
}
function painterJob(kind, key) { return painterData().jobs.find(j => j.kind === kind && j.key === key) || null; }
function painterEnd(job, ok, error) {
  const p = painterData(), i = p.jobs.findIndex(j => j.id === job.id); if (i >= 0) p.jobs.splice(i, 1);
  delete painterMem.live[job.id]; delete painterMem.tries[job.id];
  extSave(); flushSave(); painterChanged();
  document.dispatchEvent(new CustomEvent('onion:painted', { detail: { kind: job.kind, key: job.key, ok, error } }));
}
function painterDropJobs(why) { for (const j of painterData().jobs.slice()) { painterCall('DELETE', '/paint/' + encodeURIComponent(j.id), null, 8000).catch(() => {}); painterEnd(j, false, why); } }
function painterCancel(kind, key) {
  const j = painterJob(kind, key); if (!j) return;
  painterCall('DELETE', '/paint/' + encodeURIComponent(j.id), null, 8000).catch(() => {});
  painterEnd(j, false, '');
}
function painterSoon(ms) { clearTimeout(painterMem.timer); painterMem.timer = setTimeout(painterCheck, ms); }
async function painterCheck() { // 逐張問，有畫好的就收回來
  clearTimeout(painterMem.timer);
  if (painterMem.busy || !painterData().jobs.length) return;
  painterMem.busy = true;
  try {
    for (const job of painterData().jobs.slice()) {
      let st;
      try { st = await painterPoll(job.id); painterMem.reach = true; }
      catch (e) {
        if (e.offline) { painterMem.reach = false; break; }
        if (e.status === 404) painterEnd(job, false, '電腦那邊找不到這張了，再送一次就好');
        else if (e.status === 401 || e.status === 403) { painterMem.reach = false; break; }
        continue;
      }
      painterMem.live[job.id] = st;
      if (st.status === 'failed') { painterEnd(job, false, st.error || '這張沒有畫成，再試一次'); continue; }
      if (st.status !== 'done') continue;
      try {
        const img = await painterImage(job.id);
        const kept = painterOn[job.kind] ? await painterOn[job.kind](job, img) : false; // false：這張已經沒人要了（紀錄清掉、換過備份）
        if (!painterData().jobs.some(j => j.id === job.id)) continue; // 收圖的時候被取消了
        painterCall('DELETE', '/paint/' + encodeURIComponent(job.id), null, 8000).catch(() => {});
        painterEnd(job, kept !== false, '');
      } catch (e) {
        console.warn('[painter] 收圖失敗', e);
        if ((painterMem.tries[job.id] = (painterMem.tries[job.id] || 0) + 1) >= 4) painterEnd(job, false, '圖收不回來：' + (e.message || e));
      }
    }
  } finally {
    painterMem.busy = false; painterChanged();
    const jobs = painterData().jobs;
    if (jobs.length) painterSoon(painterMem.reach === false ? 15000 : Date.now() - Math.min(...jobs.map(j => j.at)) < 60000 ? 4000 : 8000);
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') painterSoon(300); });
window.addEventListener('online', () => painterSoon(500));
document.addEventListener('onion:wiped', () => { clearTimeout(painterMem.timer); painterMem.reach = null; painterChanged(); });
document.addEventListener('onion:restored', () => painterSoon(500));

// --- 配對的抽屜。done：配好之後接著做的事（例如把那一天送出去） ---
function painterSetup(done) {
  painterMem.after = done || null;
  const p = painterData();
  if (p.url && !done) return painterSheetPaired();
  const steps = [['電腦打開洋蔥的畫圖程式', '要先裝好 Codex，用你的 ChatGPT 帳號登入'], ['手機跟電腦連同一個 Wi-Fi', ''], ['掃電腦畫面上的 QR', '掃一次就好，之後會記得']];
  const el = openSheet('<h2>用電腦的 ChatGPT 畫</h2><ol class="pt-steps">' +
    steps.map(([a, b], i) => '<li><span class="no">' + (i + 1) + '</span><div class="lines"><span class="ttl">' + a + '</span>' + (b ? '<span class="meta">' + b + '</span>' : '') + '</div></li>').join('') + '</ol>' +
    (NATIVE ? '' : '<input id="ptUrl" class="pt-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="把電腦上的配對網址貼在這裡" aria-label="配對網址">') +
    '<p class="foot pt-err" id="ptErr" role="alert" hidden></p>' +
    '<div class="actions"><button class="btn primary full press" id="ptGo">' + (NATIVE ? '掃 QR' : '配對') + '</button><button class="btn plain full press" data-close>先不要</button></div>');
  const err = t => { const e = el.querySelector('#ptErr'); if (e) { e.textContent = t; e.hidden = !t; } };
  el.querySelector('#ptGo').onclick = async ev => {
    const b = ev.currentTarget; let text = ''; err('');
    if (NATIVE) {
      const nat = painterNative(); if (!nat || !nat.scanQR) { err('這一版還不能在這裡掃，用相機 app 對著 QR 掃也可以'); return; }
      try { text = (await nat.scanQR()).text; } catch (e) { if (!/cancel|取消/i.test(String(e && e.message))) err('相機打不開，到設定看看洋蔥的相機權限'); return; }
      if (!text) return;
    } else text = el.querySelector('#ptUrl').value;
    b.disabled = true; b.textContent = '配對中…';
    try { painterPaired(await painterPair(text)); }
    catch (e) { err(e.message || String(e)); b.disabled = false; b.textContent = NATIVE ? '再掃一次' : '配對'; }
  };
}
function painterPaired(r) {
  const next = painterMem.after; painterMem.after = null;
  closeSheet(); toast('已經連上' + r.name);
  if (next) next();
}
function painterSheetPaired() {
  const p = painterData(), st = () => painterMem.reach === null ? '看看連不連得到…' : painterMem.reach ? '連得到' : '連不到';
  const el = openSheet('<h2>用電腦的 ChatGPT 畫</h2><div class="section"><div class="group">' +
    '<div class="row"><span class="lbl">電腦</span><span class="val">' + esc(p.name) + '</span></div>' +
    '<div class="row"><span class="lbl">狀態</span><span class="val" id="ptSt">' + st() + '</span></div></div>' +
    '<p class="foot">連不到的話，看電腦上的畫圖程式有沒有開、手機跟電腦是不是同一個 Wi-Fi。</p></div>' +
    '<div class="group"><button class="row destructive" id="ptOff"><span class="lbl">解除配對</span></button></div>' +
    '<button class="btn secondary full press" data-close>關閉</button>');
  el.querySelector('#ptOff').onclick = () => { painterUnpair(); closeSheet(); toast('已經解除配對'); };
  painterMem.reach = null;
  painterPing().then(() => { const x = $('ptSt'); if (x) x.textContent = st(); });
}
// 用相機 app 掃到的：先問一聲再配，免得隨便一張 QR 就把圖送去別人的電腦
function painterFromUrl(url) {
  const c = painterParse(url); if (!c) return;
  const el = openSheet('<h2>讓「' + esc(c.name) + '」幫你畫圖？</h2><p>之後要畫的地圖底稿會送到這台電腦，用它的 ChatGPT 畫。底稿上沒有你走的路線，也沒有文字。</p><p class="foot pt-err" id="ptErr" role="alert" hidden></p>' +
    '<div class="actions"><button class="btn primary full press" id="ptGo">好，用這台</button><button class="btn plain full press" data-close>不要</button></div>');
  el.querySelector('#ptGo').onclick = async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try { painterPaired(await painterPair(url)); } catch (e) { b.disabled = false; const x = $('ptErr'); if (x) { x.textContent = e.message || e; x.hidden = false; } }
  };
}
function painterNative() { try { return NATIVE_ONION || null; } catch (e) { return null; } } // 70-native.js 排在後面，載入時還碰不到

// --- 設定頁「畫圖」段 ---
function painterSettings() {
  const el = $('mountPaint'); if (!el) return;
  const p = painterData(), r = painterMem.reach;
  const val = p.url ? esc(p.name) + (r === false ? '（連不到）' : '') : '還沒配對';
  el.innerHTML = '<div class="section"><h2>畫圖</h2><div class="group">' +
    '<button class="row" id="rowPainter"><span class="lbl">用電腦的 ChatGPT 畫</span><span class="val pt-val">' + val + '</span><svg class="chev"><use href="#i-chev"/></svg></button>' +
    (typeof baseRow === 'function' ? baseRow() : '') + '</div></div>';
  $('rowPainter').onclick = () => painterSetup();
  if (typeof baseRowBind === 'function') baseRowBind();
}
document.addEventListener('onion:painter', () => { if (tab === 'settings') painterSettings(); });
hook.tab.push(t => { if (t === 'settings') { painterSettings(); painterPing(); } });
hook.ready.push(() => painterSettings());
restored.then(() => { // 只等紀錄讀完，不等地圖：離線時地圖載不完，配對也要收得到
  painterSoon(800);
  const nat = painterNative();
  if (nat && nat.addListener) nat.addListener('urlOpen', e => painterFromUrl(e && e.url));
});
