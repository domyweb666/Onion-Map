"""把畫好的圖幅切成 app 用的圖磚。

用法（在 Onion-Map 目錄）：
  python tools/sheet/cut_tiles.py --sheet taipei --image "C:/path/painted.png" [--labels]

輸入的圖可以是任何解析度，但構圖要跟 base_icons 一樣（AI 重畫的就是）。
--labels 會用 layout.json 把地名用手寫字型貼回去（AI 重畫時請用 base_icons_nolabel，字它會寫錯）。
產出 tiles/<sheet>/{z}/{x}/{y}.webp（256 像素、z9 到 z13，256 格制；MapLibre 的 tileSize 要設 256）
與 tiles/<sheet>/meta.json（經緯度範圍，app 設 bounds 用）。
"""
import argparse, json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / 'fonts' / 'ChenYuluoyan.woff2'
PAPER, INK = (243, 236, 219), (46, 40, 32)


def tile_lonlat(z, x, y):
    n = 2 ** z; lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sheet', default='taipei'); ap.add_argument('--image', required=True)
    ap.add_argument('--labels', action='store_true'); ap.add_argument('--minzoom', type=int, default=9)
    ap.add_argument('--out', default=None, help='圖磚資料夾名，預設跟 sheet 一樣（比較用的版本可以另外取名）')
    args = ap.parse_args()
    layout = json.load(open(ROOT / 'sheets' / args.sheet / 'layout.json', encoding='utf-8'))
    meta = layout['meta']; Z = meta['zoom']; W, H = meta['size']; tx0, tx1 = meta['tile_x']; ty0, ty1 = meta['tile_y']
    im = Image.open(args.image).convert('RGBA')
    if im.size != (W, H): print(f'輸入 {im.size} → 放到圖幅尺寸 {(W, H)}'); im = im.resize((W, H), Image.LANCZOS)
    if args.labels:
        d = ImageDraw.Draw(im)
        for lb in layout['labels']:
            f = ImageFont.truetype(str(FONT), lb['size'])
            for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)): d.text((lb['x'] + dx, lb['y'] + dy), lb['text'], font=f, fill=PAPER)
            d.text((lb['x'], lb['y']), lb['text'], font=f, fill=INK)
        print(f'貼了 {len(layout["labels"])} 個地名')
    out = ROOT / 'tiles' / (args.out or args.sheet)
    n_tiles = 0
    for z in range(Z, args.minzoom - 1, -1):
        s = 2 ** (Z - z)  # 這一層一格等於 z13 的幾格
        # 圖幅在這一層的像素位置：左上角可能不在格線上，先鋪一張對齊格線的透明大圖
        gx0, gy0 = (tx0 // s), (ty0 // s); gx1, gy1 = (tx1 // s), (ty1 // s)
        canvas = Image.new('RGBA', ((gx1 - gx0 + 1) * 256, (gy1 - gy0 + 1) * 256), (0, 0, 0, 0))
        small = im if s == 1 else im.resize((W // s, H // s), Image.LANCZOS)
        canvas.alpha_composite(small, ((tx0 - gx0 * s) * 256 // s, (ty0 - gy0 * s) * 256 // s))
        for gx in range(gx0, gx1 + 1):
            for gy in range(gy0, gy1 + 1):
                tile = canvas.crop(((gx - gx0) * 256, (gy - gy0) * 256, (gx - gx0 + 1) * 256, (gy - gy0 + 1) * 256))
                if tile.getbbox() is None: continue  # 全透明就不存
                p = out / str(z) / str(gx) / f'{gy}.webp'; p.parent.mkdir(parents=True, exist_ok=True)
                tile.save(p, quality=82, method=6); n_tiles += 1  # WebP 比 PNG 小四五倍，MapLibre 與 iOS 都吃
    lon0, lat1 = tile_lonlat(Z, tx0, ty0); lon1, lat0 = tile_lonlat(Z, tx1 + 1, ty1 + 1)
    info = {'sheet': args.sheet, 'bounds': [round(lon0, 6), round(lat0, 6), round(lon1, 6), round(lat1, 6)], 'minzoom': args.minzoom, 'maxzoom': Z, 'tileSize': 256, 'source': Path(args.image).name}
    json.dump(info, open(out / 'meta.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'{n_tiles} 張圖磚存到 {out}，bounds {info["bounds"]}')


if __name__ == '__main__':
    main()
