// ===== 對位：AI 重畫過的地圖會飄一點（縮放、平移），用幹道與水的形狀把它對回真的位置 =====
// 從 tools/daycard/daycard.py 的 chamfer_fit／structure_of_ai／erase_red 移植。純函式，node 可以直接測（tests/align.test.mjs）。
// 整段包在 alignCore 裡，因為要把原始碼丟給 Web Worker 跑。座標一律用「卡片座標」2048×3072（跟 Python 版同一套）：X = ox + sx × 圖上的 x
/*ALIGN_START*/
function alignCore() {
  // 彩鉛圖裡的主要道路（黃、橘）與水（藍）
  function structureOfAI(d, w, h) {
    const m = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < m.length; i++, p += 4) {
      const R = d[p], G = d[p + 1], B = d[p + 2];
      if ((R > 170 && R - B > 85 && G - B > 45) || (B > R + 20 && B > G + 5 && B > 110)) m[i] = 1;
    }
    return m;
  }
  function poolMax(m, w, h, f) {
    if (f === 1) return { m, w, h };
    const W = Math.floor(w / f), H = Math.floor(h / f), o = new Uint8Array(W * H);
    for (let y = 0; y < H * f; y++) { const Y = (y / f | 0) * W, row = y * w; for (let x = 0; x < W * f; x++) if (m[row + x]) o[Y + (x / f | 0)] = 1; }
    return { m: o, w: W, h: H };
  }
  // 每一格到最近的 1 的距離（歐氏，Felzenszwalb）
  function edt(m, w, h) {
    const INF = 1e12, f = new Float64Array(w * h), n = Math.max(w, h), v = new Int32Array(n), z = new Float64Array(n + 1), col = new Float64Array(n), out = new Float64Array(n);
    for (let i = 0; i < f.length; i++) f[i] = m[i] ? 0 : INF;
    const pass = len => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        do { const p = v[k]; s = ((col[q] + q * q) - (col[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
        k++; if (k < 0) k = 0; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; out[q] = (q - p) * (q - p) + col[p]; }
    };
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) col[y] = f[y * w + x]; pass(h); for (let y = 0; y < h; y++) f[y * w + x] = out[y]; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) col[x] = f[y * w + x]; pass(w); for (let x = 0; x < w; x++) f[y * w + x] = Math.sqrt(out[x]); }
    return f;
  }
  function rand(seed) { let k = seed; return () => (k = (k * 48271) % 2147483647) / 2147483647; }
  function pick(g, f, npts, rnd) { // 遮罩裡抽 npts 個點，座標換回原圖像素（格子中心）
    const xs = [], ys = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.m[y * g.w + x]) { xs.push(x); ys.push(y); }
    const n = Math.min(npts, xs.length);
    for (let i = 0; i < n; i++) { const j = i + Math.floor(rnd() * (xs.length - i)); [xs[i], xs[j]] = [xs[j], xs[i]]; [ys[i], ys[j]] = [ys[j], ys[i]]; }
    return { n, x: Float64Array.from(xs.slice(0, n), v => (v + 0.5) * f), y: Float64Array.from(ys.slice(0, n), v => (v + 0.5) * f) };
  }
  // 邊上多留一圈 0：超出範圍的點算 0 分
  function scoreMap(g, sigma) {
    const d = edt(g.m, g.w, g.h), W = g.w + 2, e = new Float32Array(W * (g.h + 2));
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) e[(y + 1) * W + x + 1] = Math.exp(-d[y * g.w + x] / sigma);
    return { e, W, w: g.w, h: g.h };
  }
  const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(v); return o; };

  // ai：AI 圖的遮罩（aw×ah）；ref：底稿的遮罩（rw×rh，可以是 2048 或 1024 寬，裡面換算）。產生器：每算一排讓出一次，主執行緒上也不會卡住
  function* chamferFit(ai, aw, ah, ref, rw, rh, opt) {
    const o = Object.assign({ sMin: 1.55, sMax: 2.35, off: 320, pts: [400, 1200, 3000] }, opt), k = 2048 / rw, rnd = rand(7);
    const level = function* (f, sxs, sys, oxs, oys, npts, sigma) {
      const A = poolMax(ai, aw, ah, f), R = poolMax(ref, rw, rh, Math.max(1, Math.round(f / k))), fr = Math.max(1, Math.round(f / k)) * k;
      const EA = scoreMap(A, sigma), ER = scoreMap(R, sigma * f / fr), pr = pick(R, fr, npts, rnd), pa = pick(A, f, npts, rnd);
      if (!pr.n || !pa.n) return [-1, null];
      const nx = oxs.length, ny = oys.length;
      // 先把每個（縮放、位移）下每個點落在哪一行、哪一列算好，內圈只剩查表
      const table = (ss, os, ref, pts, f, size, stride, back) => ss.map(s => {
        const t = new Int32Array(os.length * ref);
        for (let i = 0; i < os.length; i++) for (let j = 0; j < ref; j++) {
          const c = Math.floor((back ? (pts[j] - os[i]) / s : os[i] + s * pts[j]) / f);
          t[i * ref + j] = (c < 0 ? 0 : c >= size ? size + 1 : c + 1) * stride;
        }
        return t;
      });
      const rxT = table(sxs, oxs, pr.n, pr.x, f, EA.w, 1, true), ryT = table(sys, oys, pr.n, pr.y, f, EA.h, EA.W, true);
      const axT = table(sxs, oxs, pa.n, pa.x, fr, ER.w, 1, false), ayT = table(sys, oys, pa.n, pa.y, fr, ER.h, ER.W, false);
      let best = -1, at = null;
      for (let a = 0; a < sxs.length; a++) {
        for (let b = 0; b < sys.length; b++) {
          const X1 = rxT[a], Y1 = ryT[b], X2 = axT[a], Y2 = ayT[b];
          for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
            let s1 = 0, s2 = 0, p = j * pr.n, q = i * pr.n; const E1 = EA.e, E2 = ER.e;
            for (let n = 0; n < pr.n; n++) s1 += E1[Y1[q + n] + X1[p + n]];
            s1 /= pr.n; if (s1 + 1 <= best) continue;
            p = j * pa.n; q = i * pa.n;
            for (let n = 0; n < pa.n; n++) s2 += E2[Y2[q + n] + X2[p + n]];
            const s = s1 + s2 / pa.n;
            if (s > best) { best = s; at = [sxs[a], sys[b], oxs[j], oys[i]]; }
          }
        }
        yield;
      }
      return [best, at];
    };
    const ss = range(o.sMin, o.sMax, 0.05), os = range(-o.off, o.off, 32);
    let [sc, at] = yield* level(16, ss, ss, os, os, o.pts[0], 1.5);
    if (!at) return { score: 0, same: true, sx: 2048 / aw, sy: 3072 / ah, ox: 0, oy: 0 };
    let [sx, sy, ox, oy] = at;
    [sc, at] = yield* level(8, range(sx - 0.06, sx + 0.06, 0.01), range(sy - 0.06, sy + 0.06, 0.01), range(ox - 40, ox + 40, 8), range(oy - 40, oy + 40, 8), o.pts[1], 2);
    [sx, sy, ox, oy] = at;
    [sc, at] = yield* level(4, range(sx - 0.012, sx + 0.012, 0.003), range(sy - 0.012, sy + 0.012, 0.003), range(ox - 10, ox + 10, 2), range(oy - 10, oy + 10, 2), o.pts[2], 2.5);
    [sx, sy, ox, oy] = at;
    // 同框（直接拉滿）的分數：對出來的沒有明顯比較好，就不要動它
    const [s0] = yield* level(4, [2048 / aw], [3072 / ah], [0], [0], o.pts[2], 2.5);
    const score = sc / 2, base = s0 / 2, same = score < 0.25 || score < base + 0.02;
    return same ? { score, base, same, sx: 2048 / aw, sy: 3072 / ah, ox: 0, oy: 0 } : { score, base, same, sx, sy, ox, oy };
  }

  // AI 自己畫了紅線就抹掉（含白邊）：用最近的、沒被遮到的顏色補，再糊一下。d 是 RGBA，直接改。回傳紅色像素數
  function eraseRed(d, w, h) {
    const n = w * h, m = new Uint8Array(n), q = new Int32Array(n), src = new Int32Array(n).fill(-1); let red = 0, head = 0, tail = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) { const R = d[p], G = d[p + 1], B = d[p + 2]; if (R > 110 && G < 120 && B < 120 && R - Math.max(G, B) > 80) { m[i] = 1; red++; q[tail++] = i; } }
    if (!red) return 0;
    for (let it = 0; it < 7; it++) { // 往外長七圈
      const end = tail;
      for (; head < end; head++) {
        const i = q[head], x = i % w;
        if (x > 0 && !m[i - 1]) { m[i - 1] = 1; q[tail++] = i - 1; } if (x < w - 1 && !m[i + 1]) { m[i + 1] = 1; q[tail++] = i + 1; }
        if (i >= w && !m[i - w]) { m[i - w] = 1; q[tail++] = i - w; } if (i < n - w && !m[i + w]) { m[i + w] = 1; q[tail++] = i + w; }
      }
    }
    const masked = q.slice(0, tail);
    head = tail = 0; // 從遮罩邊上往裡面傳顏色
    for (const i of masked) { const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < n && !m[j]) { src[i] = j; q[tail++] = i; break; } }
    while (head < tail) {
      const i = q[head++], x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < n && m[j] && src[j] < 0) { src[j] = src[i]; q[tail++] = j; }
    }
    for (const i of masked) if (src[i] >= 0) for (let c = 0; c < 3; c++) d[i * 4 + c] = d[src[i] * 4 + c];
    const K = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(v => Math.exp(-v * v / 8)), out = new Uint8Array(masked.length * 3);
    masked.forEach((i, k) => {
      const x = i % w, y = i / w | 0; let W = 0, r = 0, g = 0, b = 0;
      for (let dy = -4; dy <= 4; dy++) { const Y = y + dy; if (Y < 0 || Y >= h) continue; for (let dx = -4; dx <= 4; dx++) { const X = x + dx; if (X < 0 || X >= w) continue; const f = K[dx + 4] * K[dy + 4], p = (Y * w + X) * 4; W += f; r += f * d[p]; g += f * d[p + 1]; b += f * d[p + 2]; } }
      out[k * 3] = r / W; out[k * 3 + 1] = g / W; out[k * 3 + 2] = b / W;
    });
    masked.forEach((i, k) => { d[i * 4] = out[k * 3]; d[i * 4 + 1] = out[k * 3 + 1]; d[i * 4 + 2] = out[k * 3 + 2]; });
    return red;
  }
  function* job(rgba, w, h, ref, rw, rh) { // 一次做完：抹紅線、抓結構、對位。回傳 {fit, red}，rgba 已經改過
    const red = eraseRed(rgba, w, h); yield;
    const fit = yield* chamferFit(structureOfAI(rgba, w, h), w, h, ref, rw, rh);
    return { fit, red };
  }
  const run = g => { let r; do r = g.next(); while (!r.done); return r.value; };
  return { structureOfAI, chamferFit, eraseRed, poolMax, edt, job, run };
}
/*ALIGN_END*/

// 給畫面用：先試 Web Worker，不行就在主執行緒一小段一小段跑
async function alignPainted(rgba, w, h, ref, rw, rh) {
  try {
    const src = 'const A=(' + alignCore.toString() + ')();onmessage=e=>{const m=e.data,v=A.run(A.job(m.rgba,m.w,m.h,m.ref,m.rw,m.rh));postMessage({v,rgba:m.rgba},[m.rgba.buffer]);};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try {
      return await new Promise((ok, bad) => {
        const wk = new Worker(url), t = setTimeout(() => { wk.terminate(); bad(new Error('對位太久')); }, 30000);
        wk.onmessage = e => { clearTimeout(t); wk.terminate(); ok(Object.assign(e.data.v, { rgba: e.data.rgba })); };
        wk.onerror = e => { clearTimeout(t); wk.terminate(); bad(new Error(e.message || 'worker')); };
        wk.postMessage({ rgba, w, h, ref, rw, rh }); // 這裡複製一份，失敗還能用原本的
      });
    } finally { URL.revokeObjectURL(url); }
  } catch (e) {
    const A = alignCore(), g = A.job(rgba, w, h, ref, rw, rh); let t = performance.now();
    for (;;) { const r = g.next(); if (r.done) return Object.assign(r.value, { rgba }); if (performance.now() - t > 40) { await new Promise(s => setTimeout(s, 0)); t = performance.now(); } }
  }
}
