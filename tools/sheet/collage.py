"""路 B：程式拼貼。用底稿器的遮罩、線條、排版（layout.json）加無縫材質與貼紙，拼出一張手繪風圖幅。

用法：python tools/sheet/collage.py --sheet taipei [--cut]
材質放 assets/textures/：forest、urban、water、meadow、paper（缺的用程式算的頂上）。
產出 sheets/<sheet>/collage.png、collage_preview.png；--cut 會順便切成 tiles/<sheet>-b/
"""
import argparse, json, math, subprocess, sys, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
TEX = ROOT / 'assets' / 'textures'
SPRITES = ROOT / 'assets' / 'sprites'
FONT = ROOT / 'fonts' / 'ChenYuluoyan.woff2'
PAPER, INK = (243, 236, 219), (46, 40, 32)
rng = np.random.default_rng(11)


def load_tex(name, W, H, fallback):
    p = TEX / f'{name}.png'
    if p.exists():
        t = np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255
        reps = (math.ceil(H / t.shape[0]), math.ceil(W / t.shape[1]), 1)
        return np.tile(t, reps)[:H, :W]
    print(f'  沒有材質 {name}.png，用程式算的頂上')
    return fallback(W, H)


def flat(color):
    return lambda W, H: np.ones((H, W, 3), np.float32) * (np.array(color, np.float32) / 255)


def paper_tex(W, H):
    base = np.ones((H, W, 3), np.float32) * (np.array(PAPER, np.float32) / 255)
    n = ndi.gaussian_filter(rng.random((H, W)).astype(np.float32), 1.2); n = (n - n.mean()) / (n.std() + 1e-6)
    stain = ndi.gaussian_filter(rng.random((H // 16 + 1, W // 16 + 1)).astype(np.float32), 3); stain = ndi.zoom(stain, 16, order=1)[:H, :W]
    stain = (stain - stain.mean()) / (stain.std() + 1e-6)
    return np.clip(base * (1 + 0.035 * n[..., None] + 0.04 * stain[..., None]), 0, 1)


def warp_mask(m, amp_px, freq_px):
    """用低頻雜訊把遮罩邊緣推歪，像手撕、手畫的邊"""
    H, W = m.shape; s = max(1, int(freq_px))
    fx = ndi.zoom(ndi.gaussian_filter(rng.standard_normal((H // s + 2, W // s + 2)), 1.0), s, order=1)[:H, :W]
    fy = ndi.zoom(ndi.gaussian_filter(rng.standard_normal((H // s + 2, W // s + 2)), 1.0), s, order=1)[:H, :W]
    yy, xx = np.mgrid[0:H, 0:W]
    return ndi.map_coordinates(m, [yy + fy * amp_px, xx + fx * amp_px], order=1, mode='nearest')


def edge_of(m, px):
    hard = m > 0.5
    return (hard & ~ndi.binary_erosion(hard, iterations=px)).astype(np.float32)


def pencil_line(d, pts, color, width, jitter=1.2, passes=2):
    """鉛筆線：同一條線抖兩次疊起來，粗細不勻"""
    for k in range(passes):
        q = [(x + rng.normal(0, jitter), y + rng.normal(0, jitter)) for x, y in pts]
        d.line(q, fill=color, width=max(1, int(round(width * (0.8 + 0.4 * rng.random())))), joint='curve')


def dashed(d, pts, color, width, on, off, jitter=0.8):
    pos = 0.0; draw = True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); cur = 0.0
        while cur < L:
            step = min((on if draw else off) - pos, L - cur)
            sx, sy = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L; cur += step
            ex, ey = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L
            if draw: d.line([(sx + rng.normal(0, jitter), sy + rng.normal(0, jitter)), (ex + rng.normal(0, jitter), ey + rng.normal(0, jitter))], fill=color, width=width)
            pos += step
            if pos >= (on if draw else off) - 1e-6: pos = 0.0; draw = not draw


def paste_sprite(canvas, sp, name, x, y, w, flip=False):
    im = sp[name]; h = w * im.height / im.width
    im = im.resize((max(1, int(round(w))), max(1, int(round(h)))), Image.LANCZOS)
    if name.startswith('forest-clump'):  # 樹叢貼紙去背留了一圈灰邊，鋪在綠材質上很明顯，把半透明的邊切掉
        a = np.asarray(im.getchannel('A')).astype(np.float32); a = np.where(a < 120, 0, np.clip((a - 120) / 135 * 255, 0, 255))
        im.putalpha(Image.fromarray(a.astype(np.uint8)))
    if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
    left, top = int(round(x - w / 2)), int(round(y - h))
    cl, ct = max(0, -left), max(0, -top); cr, cb = min(im.width, canvas.width - left), min(im.height, canvas.height - top)
    if cr <= cl or cb <= ct: return
    canvas.alpha_composite(im.crop((cl, ct, cr, cb)), (left + cl, top + ct))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sheet', default='taipei'); ap.add_argument('--cut', action='store_true')
    args = ap.parse_args(); t0 = time.time()
    sd = ROOT / 'sheets' / args.sheet
    layout = json.load(open(sd / 'layout.json', encoding='utf-8')); meta = layout['meta']; W, H = meta['size']; mpp = meta['m_per_px']
    px = lambda m: m / mpp
    lines = json.load(open(sd / 'lines.json'))
    load = lambda n: np.asarray(Image.open(sd / 'masks' / f'{n}.png')).astype(np.float32) / 255
    water, urban, forest, hs = load('water'), load('urban'), load('forest'), load('hillshade')
    print(f'圖幅 {W}x{H}，讀遮罩 {time.time() - t0:.1f}s')

    # 1. 底：紙 → 草地鋪滿陸地 → 森林、市區、水各鋪自己的材質。邊緣先推歪再鋪，才不像電腦切的
    img = load_tex('paper', W, H, paper_tex)
    forest_tex = load_tex('forest', W, H, flat((160, 190, 110)))
    # 草地：沒有專用材質就拿森林材質調淡一點（AI 那張全部陸地都是綠色排線，照它）
    meadow = load_tex('meadow', W, H, lambda W_, H_: forest_tex * 0.55 + img * 0.45)
    land = 1 - water
    img = img * (1 - land[..., None] * 0.9) + meadow * land[..., None] * 0.9
    forest_w = np.clip(warp_mask(forest, px(140), px(900)), 0, 1)
    forest_w = ndi.gaussian_filter((forest_w > 0.5).astype(np.float32), 1.0)
    urban_w = np.clip(warp_mask(urban, px(90), px(600)), 0, 1)
    urban_w = ndi.gaussian_filter((urban_w > 0.5).astype(np.float32), 1.0) * (1 - water)
    forest_w = forest_w * (1 - urban_w)
    for name, m, tex in (('forest', forest_w, forest_tex), ('urban', urban_w, load_tex('urban', W, H, flat((226, 200, 160)))), ('water', water, load_tex('water', W, H, flat((150, 190, 225))))):
        img = img * (1 - m[..., None]) + tex * m[..., None]
    # 2. 邊：森林外圈一道深綠、市區一道褐、岸邊一圈圈藍，再加整體的淡高程陰影
    def rim(m, px_w, color, alpha, blur=1.5):
        nonlocal img
        e = ndi.gaussian_filter(edge_of(m, max(1, int(px_w))), blur)[..., None] * alpha
        img = img * (1 - e) + (np.array(color, np.float32) / 255) * e
    rim(forest_w, px(60), (70, 110, 50), 0.55); rim(urban_w, px(40), (120, 80, 40), 0.45)
    wd = ndi.distance_transform_edt(water > 0.5)
    for d0, d1, a in ((0, px(40), 0.45), (px(90), px(130), 0.25), (px(200), px(240), 0.14)):
        band = ((wd > d0) & (wd <= d1)).astype(np.float32); band = ndi.gaussian_filter(band, 1.0)[..., None] * a
        img = img * (1 - band) + (np.array((70, 120, 170), np.float32) / 255) * band
    shade = 1 - (1 - ndi.gaussian_filter(hs, 2.5)) * 0.18 * (1 - water)
    img = img * shade[..., None]
    canvas = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
    print(f'材質鋪完 {time.time() - t0:.1f}s')

    # 3. 線：海岸線、河、路，都是鉛筆線；畫在兩倍大的透明層再縮小
    ss = 2
    lay = Image.new('RGBA', (W * ss, H * ss), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    S = lambda pts: [(x * ss, y * ss) for x, y in pts]
    for pts in lines['coast']:
        if len(pts) > 1: pencil_line(d, S(pts), (50, 90, 130, 235), 2.2 * ss, jitter=1.0 * ss)
    for pts in lines['rivers']:
        if len(pts) > 1: pencil_line(d, S(pts), (90, 140, 190, 220), 2.4 * ss, jitter=0.9 * ss); pencil_line(d, S(pts), (160, 200, 235, 160), 1.0 * ss, jitter=0.9 * ss, passes=1)
    for pts in lines['roads']:
        if len(pts) > 1: dashed(d, S(pts), (120, 90, 55, 230), int(1.8 * ss), 9 * ss, 6 * ss, jitter=0.6 * ss)
    canvas.alpha_composite(lay.resize((W, H), Image.LANCZOS))

    # 4. 貼紙：照 layout.json，由上往下
    sp = {p.stem: Image.open(p).convert('RGBA') for p in SPRITES.glob('*.png') if not p.name.startswith('_')}
    for it in sorted(layout['items'], key=lambda i: i['y']): paste_sprite(canvas, sp, it['name'], it['x'], it['y'], it['w'], it['flip'])
    # 5. 地名
    d = ImageDraw.Draw(canvas)
    for lb in layout['labels']:
        f = ImageFont.truetype(str(FONT), lb['size'])
        for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)): d.text((lb['x'] + dx, lb['y'] + dy), lb['text'], font=f, fill=PAPER)
        d.text((lb['x'], lb['y']), lb['text'], font=f, fill=INK)
    # 6. 紙的顆粒鋪在最上面（乘法），貼紙和材質才會像畫在同一張紙上
    grain = paper_tex(W, H).mean(axis=2); grain = 0.9 + 0.1 * (grain - grain.min()) / (grain.max() - grain.min() + 1e-6)
    arr = np.asarray(canvas.convert('RGB')).astype(np.float32) * grain[..., None]
    final = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    final.save(sd / 'collage.png'); final.resize((W // 2, H // 2), Image.LANCZOS).save(sd / 'collage_preview.png')
    print(f'collage.png 存好 {time.time() - t0:.1f}s')
    if args.cut:
        subprocess.run([sys.executable, str(ROOT / 'tools' / 'sheet' / 'cut_tiles.py'), '--sheet', args.sheet, '--image', str(sd / 'collage.png'), '--out', args.sheet + '-b'], check=True)


if __name__ == '__main__':
    main()
