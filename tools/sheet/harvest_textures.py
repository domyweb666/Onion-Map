"""從一張畫好的圖幅裡「採」無縫材質，當路 B 的替代材質（多米生了正式材質後直接換檔案）。

用法：python tools/sheet/harvest_textures.py --sheet taipei --image sheets/taipei/painted_v2_source.png
每種材質在自己的遮罩範圍裡自動找「最乾淨」的一塊（顏色最均勻、沒有圖示沒有河），
滾半格混邊做成無縫，存 assets/textures/{forest,urban,water,meadow}.png 與 _candidates.png 對照表。
"""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'textures'


def seamless(a):
    """滾半格再用平滑權重混回去：四邊變成原圖的中線，接起來沒縫"""
    h, w = a.shape[:2]
    rolled = np.roll(np.roll(a, h // 2, axis=0), w // 2, axis=1)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.abs(xx - w / 2) / (w / 2); dy = np.abs(yy - h / 2) / (h / 2)
    sm = lambda d: np.clip((d - 0.08) / 0.55, 0, 1) ** 1.5
    wgt = (sm(dx) * sm(dy))[..., None]
    return rolled * wgt + a * (1 - wgt)


def cleanest_window(img, mask, size, stride=16, blue_penalty=False):
    """在遮罩裡找 size 見方、顏色最均勻的一格：每個像素到該區中位色的距離，做方框平均，取最小"""
    H, W = mask.shape
    sel = mask > 0.5
    if sel.sum() < size * size: return None
    med = np.median(img[sel], axis=0)
    dist = np.sqrt(((img - med) ** 2).sum(axis=2))
    if blue_penalty: dist = dist + 90 * np.clip((img[..., 2] - img[..., 0] - 20) / 60, 0, 1)  # 陸地材質裡不要有河
    dist[~sel] = 60  # 遮罩外算很差
    score = ndi.uniform_filter(dist, size, mode='constant', cval=99)
    cov = ndi.uniform_filter(sel.astype(np.float32), size, mode='constant')
    score[cov < 0.92] = 1e9
    # 只看視窗中心能落在圖內的位置
    half = size // 2; sub = score[half:H - half:stride, half:W - half:stride]
    j, i = np.unravel_index(np.argmin(sub), sub.shape)
    cy, cx = half + j * stride, half + i * stride
    if sub[j, i] >= 1e9: return None
    return (int(cx - half), int(cy - half), int(cx + half), int(cy + half), float(sub[j, i]))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sheet', default='taipei'); ap.add_argument('--image', required=True)
    ap.add_argument('--size', type=int, default=448)
    args = ap.parse_args()
    sd = ROOT / 'sheets' / args.sheet
    meta = json.load(open(sd / 'layout.json', encoding='utf-8'))['meta']; W, H = meta['size']
    im = Image.open(args.image).convert('RGB')
    if im.size != (W, H): im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    load = lambda n: np.asarray(Image.open(sd / 'masks' / f'{n}.png')).astype(np.float32) / 255
    water, urban, forest = load('water'), load('urban'), load('forest')
    # 圖示佔的地方不要採
    icons = np.zeros((H, W), np.float32)
    for it in json.load(open(sd / 'layout.json', encoding='utf-8'))['items']:
        b = it['box']; icons[max(0, int(b[1])):int(b[3]) + 1, max(0, int(b[0])):int(b[2]) + 1] = 1
    # 草地不採：AI 把紙色的陸地也畫成屋頂，採不到真的草地，拼貼時用森林材質調淡代替
    masks = {'water': (water, 448, False), 'forest': (forest * (1 - icons), 224, True), 'urban': (urban * (1 - icons), 256, True)}
    OUT.mkdir(parents=True, exist_ok=True)
    if (OUT / 'meadow.png').exists(): (OUT / 'meadow.png').unlink()
    cell = 320; sheet = Image.new('RGB', (cell * 2, len(masks) * cell), (40, 40, 40)); picks = {}
    for r, (name, (m, size, bp)) in enumerate(masks.items()):
        win = None
        while win is None and size >= 128: win = cleanest_window(a, m, size, blue_penalty=bp); size -= 32
        if win is None: print('  找不到乾淨的', name); continue
        x0, y0, x1, y1, sc = win; picks[name] = [x0, y0, x1, y1]
        crop = a[y0:y1, x0:x1]
        tex = Image.fromarray(np.clip(seamless(crop), 0, 255).astype(np.uint8))
        tex.save(OUT / f'{name}.png')
        print(f'  {name}: 框 {x0},{y0}-{x1},{y1}（{x1 - x0} px）均勻度 {sc:.1f}')
        sheet.paste(Image.fromarray(crop.astype(np.uint8)).resize((cell - 10, cell - 10)), (0, r * cell))
        n = tex.width; tiled = Image.new('RGB', (n * 2, n * 2)); [tiled.paste(tex, (i * n, j * n)) for i in range(2) for j in range(2)]
        sheet.paste(tiled.resize((cell - 10, cell - 10)), (cell, r * cell))
    sheet.save(OUT / '_candidates.png')
    json.dump(picks, open(OUT / '_picks.json', 'w'), indent=1)
    print('材質存到', OUT, '；對照表 _candidates.png（每列一種：左原裁切，右接四格看縫）')


if __name__ == '__main__':
    main()
