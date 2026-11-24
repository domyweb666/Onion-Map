// 對位的測試：node --test tests/align.test.mjs
// 合成的一定跑；跟 Python 版對照的那題要有 daycard/2026-11-07 和裝好 Pillow 的 python，沒有就跳過
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/js/53-align.js'), 'utf8').split('/*ALIGN_START*/')[1].split('/*ALIGN_END*/')[0];
const A = vm.runInNewContext(src + ';alignCore()');

function lines(w, h, segs, r) { // 幾條粗線的遮罩
  const m = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of segs) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) { const cx = x0 + (x1 - x0) * i / n, cy = y0 + (y1 - y0) * i / n; for (let y = Math.max(0, cy - r | 0); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r | 0); x <= Math.min(w - 1, cx + r); x++) m[y * w + x] = 1; } }
  return m;
}
const SEGS = [[100, 200, 1900, 500], [300, 0, 500, 3000], [1500, 100, 1300, 2900], [0, 1500, 2047, 1200], [200, 2700, 1900, 2100], [900, 300, 1100, 1700]];

test('合成圖：縮放 1.9／1.95、位移 60,-30 找得回來', () => {
  const ref = lines(2048, 3072, SEGS, 7), inv = SEGS.map(([a, b, c, d]) => [(a - 60) / 1.9, (b + 30) / 1.95, (c - 60) / 1.9, (d + 30) / 1.95]);
  const ai = lines(1024, 1536, inv, 4), r = A.run(A.chamferFit(ai, 1024, 1536, ref, 2048, 3072));
  assert.ok(!r.same); assert.ok(Math.abs(r.sx - 1.9) < 0.02 && Math.abs(r.sy - 1.95) < 0.02, JSON.stringify(r));
  assert.ok(Math.abs(r.ox - 60) < 16 && Math.abs(r.oy + 30) < 24, JSON.stringify(r));
});
test('完全不像的兩張：當作同框', () => {
  const ref = lines(1024, 1536, [[0, 20, 1023, 20]], 4), ai = lines(1024, 1536, [[500, 700, 520, 720]], 2);
  const r = A.run(A.chamferFit(ai, 1024, 1536, ref, 1024, 1536));
  assert.ok(r.same); assert.equal(r.sx, 2); assert.equal(r.ox, 0);
});
test('空的遮罩不會掛', () => { const r = A.run(A.chamferFit(new Uint8Array(64 * 96), 64, 96, new Uint8Array(1024 * 1536), 1024, 1536)); assert.ok(r.same); });
test('距離圖：到 1 的歐氏距離', () => { const m = new Uint8Array(25); m[0] = 1; const d = A.edt(m, 5, 5); assert.ok(Math.abs(d[24] - Math.hypot(4, 4)) < 1e-9); assert.equal(d[0], 0); });
test('抹紅線：紅的不見、旁邊的顏色補上，其他不動', () => {
  const w = 60, h = 40, d = new Uint8ClampedArray(w * h * 4).fill(200);
  for (let y = 18; y < 22; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; d[p] = 210; d[p + 1] = 40; d[p + 2] = 30; }
  assert.equal(A.eraseRed(d, w, h), 240);
  for (let i = 0; i < w * h; i++) assert.ok(d[i * 4 + 1] > 190, '還有紅的');
});
const dir = path.join(ROOT, 'daycard/2026-11-07');
const pillow = (() => { try { execFileSync('python', ['-c', 'import PIL'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
test('真的圖：跟 Python 的結果一樣（縮放約 1.92、位移 82,8、貼合度 0.70）', { skip: !fs.existsSync(dir + '/painted_pencil_v2.png') || !pillow }, t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'align-'));
  execFileSync('python', ['-c', `
import sys
from PIL import Image
d,o=sys.argv[1],sys.argv[2]
open(o+'/a.raw','wb').write(Image.open(d+'/painted_pencil_v2.png').convert('RGBA').tobytes())
r=Image.open(d+'/structure.png').convert('L')
open(o+'/r.raw','wb').write(r.tobytes())
open(o+'/r1.raw','wb').write(r.resize((1024,1536),Image.BOX).tobytes())
`, dir, tmp]);
  const rgba = new Uint8ClampedArray(fs.readFileSync(tmp + '/a.raw')), bin = f => Uint8Array.from(fs.readFileSync(tmp + f), v => v > 127 ? 1 : 0);
  for (const [name, f, w, h] of [['底稿 2048', '/r.raw', 2048, 3072], ['底稿 1024', '/r1.raw', 1024, 1536]]) {
    const t0 = performance.now(), r = A.run(A.chamferFit(A.structureOfAI(rgba, 1024, 1536), 1024, 1536, bin(f), w, h));
    t.diagnostic(`${name}：縮放 ${r.sx.toFixed(3)} x ${r.sy.toFixed(3)}，位移 ${r.ox.toFixed(0)},${r.oy.toFixed(0)}，貼合度 ${r.score.toFixed(3)}（同框 ${r.base.toFixed(3)}），${Math.round(performance.now() - t0)} ms`);
    assert.ok(!r.same && Math.abs(r.sx - 1.92) < 0.02 && Math.abs(r.sy - 1.92) < 0.03 && Math.abs(r.ox - 82) <= 12 && Math.abs(r.oy - 8) <= 12 && Math.abs(r.score - 0.7) < 0.05, JSON.stringify(r));
  }
  const t0 = performance.now(), red = A.eraseRed(rgba, 1024, 1536); t.diagnostic(`抹紅線：${red} px，${Math.round(performance.now() - t0)} ms`);
  fs.rmSync(tmp, { recursive: true });
});
test('第二筆：Codex 畫的成品（幾乎沒飄），含輸出變成 1122x1402 的兩種情況', { skip: !fs.existsSync(dir + '/painted_cli.png') }, t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'align-'));
  execFileSync('python', ['-c', `
import sys
from PIL import Image
d,o=sys.argv[1],sys.argv[2]
im=Image.open(d+'/painted_cli.png').convert('RGBA'); L=Image.LANCZOS
w,h=im.size; ch=round(w*1402/1122); top=(h-ch)//2
for n,x in (('orig',im),('squash',im.resize((1122,1402),L)),('crop',im.crop((0,top,w,top+ch)).resize((1122,1402),L))):
    open(o+'/'+n,'wb').write(x.resize((1024,1536),L).tobytes())
open(o+'/r','wb').write(Image.open(d+'/structure.png').convert('L').resize((1024,1536),Image.BOX).tobytes())
`, dir, tmp]);
  const ref = Uint8Array.from(fs.readFileSync(tmp + '/r'), v => v > 127 ? 1 : 0), fit = n => { const r = A.run(A.chamferFit(A.structureOfAI(new Uint8ClampedArray(fs.readFileSync(tmp + '/' + n)), 1024, 1536), 1024, 1536, ref, 1024, 1536)); t.diagnostic(`${n}：縮放 ${r.sx.toFixed(3)} x ${r.sy.toFixed(3)}，位移 ${r.ox.toFixed(0)},${r.oy.toFixed(0)}，貼合度 ${r.score.toFixed(3)}（同框 ${r.base.toFixed(3)}${r.same ? '，當同框' : ''}）`); return r; };
  for (const n of ['orig', 'squash']) { const r = fit(n); assert.ok(Math.abs(r.sx - 2) < 0.03 && Math.abs(r.sy - 2) < 0.03 && Math.abs(r.ox) < 24 && Math.abs(r.oy) < 24, JSON.stringify(r)); }
  const c = fit('crop'), k = Math.round(1024 * 1402 / 1122) / 1536; // 上下被裁掉：縱向縮放變小、往下移
  assert.ok(Math.abs(c.sx - 2) < 0.03 && Math.abs(c.sy - 2 * k) < 0.04 && Math.abs(c.oy - 3072 * (1 - k) / 2) < 30, JSON.stringify(c));
  fs.rmSync(tmp, { recursive: true });
});
