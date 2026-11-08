"""把一張透明背景的邊框 PNG 蓋在 AI 畫的地圖上。

邊框是固定尺寸的直式圖（1024x1536 或 1080x1620 都行），中間透明的那塊是「窗」。
窗不用量：程式從圖中心沿著 alpha 低的區域往外找，找到窗的外框（含內緣那圈暈），
地圖等比放大到蓋滿窗、貼進去，再把邊框疊上去，撕邊以外鋪底色。

用法（在 Onion-Map 目錄）：
  python tools/daycard/overlay_frame.py --map daycard/2026-11-07/painted.png --frame assets/frames/flowers.png --out daycard/2026-11-07/framed.png
  選項：--size 1080x1620（輸出尺寸）  --bg F4EEE0（撕邊外的底色）  --bleed 0（窗往外多貼幾像素）  --info（只印窗的位置）
        --inner shadow|hard|keep  窗內緣那圈米色暈怎麼辦：預設 shadow 改成焦褐陰影（黑霧貼著框不會有白邊）、hard 整圈切掉、keep 照原樣

輸出成功會印出窗在輸出圖上的座標 (left, top, right, bottom)，compose 寫字時用它決定安全區。
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def find_window(frame: Image.Image, thresh: int = 250):
    """窗 = 從圖中心出發、alpha < thresh 連成一片的區域。回傳 (l, t, r, b)，右下是不含的邊界。"""
    a = np.array(frame.convert('RGBA'))[:, :, 3]
    low = a < thresh
    lab, _ = ndi.label(low)
    h, w = a.shape
    cid = lab[h // 2, w // 2]
    if cid == 0:
        raise SystemExit('圖中心不透明，這張不像有窗的邊框')
    ys, xs = np.where(lab == cid)
    # 撕邊外面也透明，可能跟窗連在一起（框有缺口時）；用窗的主體剪掉：只取靠近中心、連續的那段
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fix_inner(frame: Image.Image, mode: str = 'shadow', thresh: int = 250) -> Image.Image:
    """AI 產的框，窗的內緣常帶一圈米色半透明暈，蓋在黑霧上會變成灰白邊。
    shadow：把那圈暈改成焦褐色（陰影感，多米選的）；hard：把暈整個切掉；keep：不動。"""
    if mode == 'keep':
        return frame
    arr = np.array(frame.convert('RGBA'))
    a = arr[:, :, 3]
    h, w = a.shape
    lab, _ = ndi.label(a < thresh)
    win = lab == lab[h // 2, w // 2]
    feather = win & (a > 0)
    if mode == 'hard':
        arr[:, :, 3][feather] = 0
    else:
        arr[:, :, :3][feather] = (58, 40, 24)
        arr[:, :, 3][feather] = (a[feather].astype(float) * 0.7).astype(np.uint8)
    return Image.fromarray(arr)


def cover(img: Image.Image, box):
    l, t, r, b = box
    bw, bh = r - l, b - t
    s = max(bw / img.width, bh / img.height)
    big = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    ox, oy = (big.width - bw) // 2, (big.height - bh) // 2
    return big.crop((ox, oy, ox + bw, oy + bh))


def overlay(map_path, frame_path, out_path, size=(1080, 1620), bg='F4EEE0', bleed=0, inner='shadow'):
    frame = fix_inner(Image.open(frame_path).convert('RGBA'), inner)
    painted = Image.open(map_path).convert('RGBA')
    l, t, r, b = find_window(frame)
    box = (max(0, l - bleed), max(0, t - bleed), min(frame.width, r + bleed), min(frame.height, b + bleed))
    rgb = tuple(int(bg[i:i + 2], 16) for i in (0, 2, 4))
    out = Image.new('RGBA', frame.size, rgb + (255,))
    out.alpha_composite(cover(painted, box), (box[0], box[1]))
    out.alpha_composite(frame)
    sx, sy = size[0] / frame.width, size[1] / frame.height
    out = out.resize(size, Image.LANCZOS)
    out.convert('RGB').save(out_path, quality=95)
    win = [round(box[0] * sx), round(box[1] * sy), round(box[2] * sx), round(box[3] * sy)]
    return win


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map')
    ap.add_argument('--frame', required=True)
    ap.add_argument('--out')
    ap.add_argument('--size', default='1080x1620')
    ap.add_argument('--bg', default='F4EEE0')
    ap.add_argument('--bleed', type=int, default=0)
    ap.add_argument('--inner', choices=['shadow', 'hard', 'keep'], default='shadow', help='窗內緣那圈暈怎麼處理：shadow 改成焦褐陰影（預設）、hard 切掉、keep 保留')
    ap.add_argument('--info', action='store_true')
    a = ap.parse_args()
    size = tuple(int(x) for x in a.size.lower().split('x'))
    if a.info:
        fr = Image.open(a.frame).convert('RGBA')
        print(json.dumps({'frame': fr.size, 'window': find_window(fr)}))
        return
    if not a.out or not a.map:
        sys.exit('要給 --map 與 --out')
    win = overlay(a.map, a.frame, a.out, size, a.bg, a.bleed, a.inner)
    print(json.dumps({'out': str(Path(a.out)), 'size': size, 'window': win}, ensure_ascii=False))


if __name__ == '__main__':
    main()
