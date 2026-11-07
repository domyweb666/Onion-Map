"""一日洋蔥地圖：出「真實地圖原圖加路線」，給多米自己丟 AI 選風格用。

用法：python tools/daycard/rawmap.py --track daycard/demo-track.json --date 2026-11-07 [--trim 0] [--style osm|voyager] [--zoom 16]
輸出到 daycard/<date>/：
  map_<style>_plain.png        只有地圖與路線，沒有邊（自由使用）
  map_<style>_plain_noroute.png 只有地圖
  map_<style>.png              跟卡片同框：紙邊、同一個範圍（AI 畫完可以 compose --painted 套框寫字）

圖磚來源：osm = OpenStreetMap 標準圖（© OpenStreetMap 貢獻者，ODbL），voyager = CARTO Voyager。
都是公開圖磚服務，一次抓幾十張沒問題，別拿來大量下載。
"""
import argparse, io, math, sys, time, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daycard import ROOT, CACHE, CONTENT, W2, H2, PAPER, load_day, extent_for, tex_array  # noqa: E402

STYLES = {'osm': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'voyager': 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'}
UA = {'User-Agent': 'onion-map-daycard/0.1 (personal project; contact via github domyweb666/Onion-Map)'}


def fetch_png(url, path):
    if path.exists(): return Image.open(path).convert('RGB')
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: data = r.read()
            path.write_bytes(data); time.sleep(0.15); return Image.open(io.BytesIO(data)).convert('RGB')
        except Exception as e:
            if attempt == 2: raise
            time.sleep(1.5)


def world(lon, lat, z):
    n = 256 * 2 ** z; s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--track', required=True); ap.add_argument('--date'); ap.add_argument('--trim', type=float, default=300)
    ap.add_argument('--style', default='osm', choices=list(STYLES)); ap.add_argument('--zoom', type=int, default=16)
    args = ap.parse_args()
    date, pts, layer, trimmed = load_day(args.track, args.date, args.trim)
    fr = extent_for([(p[2], p[1]) for p in pts]); lon0, lat0, lon1, lat1 = fr.bounds; z = args.zoom
    x0, y0 = world(lon0, lat1, z); x1, y1 = world(lon1, lat0, z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1); print(f'{args.style} z{z}：{n} 張圖磚')
    mosaic = Image.new('RGB', ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            mosaic.paste(fetch_png(STYLES[args.style].format(z=z, x=tx, y=ty), CACHE / 'raster' / args.style / f'{z}_{tx}_{ty}.png'), ((tx - tx0) * 256, (ty - ty0) * 256))
    crop = mosaic.crop((round(x0 - tx0 * 256), round(y0 - ty0 * 256), round(x1 - tx0 * 256), round(y1 - ty0 * 256)))
    cw, ch = CONTENT[2] - CONTENT[0], CONTENT[3] - CONTENT[1]
    plain = crop.resize((cw, ch), Image.LANCZOS)  # 跟卡片內容框一樣大，路線座標直接共用
    out = ROOT / 'daycard' / date; out.mkdir(parents=True, exist_ok=True)
    plain.save(out / f'map_{args.style}_plain_noroute.png')
    # 路線：白邊紅線，起點綠點、終點紅點
    route = [(fr.px(p[2], p[1])[0] - CONTENT[0], fr.px(p[2], p[1])[1] - CONTENT[1]) for p in pts]
    thin = [route[0]]
    for q in route[1:]:
        if math.hypot(q[0] - thin[-1][0], q[1] - thin[-1][1]) >= 6: thin.append(q)
    def draw_route(im, ox=0, oy=0):
        d = ImageDraw.Draw(im); pts_ = [(x + ox, y + oy) for x, y in thin]
        d.line(pts_, fill=(255, 255, 255), width=20, joint='curve'); d.line(pts_, fill=(214, 40, 40), width=11, joint='curve')
        for (x, y), col in ((pts_[0], (40, 160, 70)), (pts_[-1], (200, 30, 30))):
            d.ellipse([x - 18, y - 18, x + 18, y + 18], fill=(255, 255, 255)); d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=col)
    withroute = plain.copy(); draw_route(withroute); withroute.save(out / f'map_{args.style}_plain.png')
    # 同框版：紙邊 + 內容框，跟 draft.png 一樣的構圖
    paper = Image.fromarray((tex_array('paper', (W2, H2), PAPER) * 255).astype(np.uint8))
    paper.paste(withroute, (CONTENT[0], CONTENT[1])); paper.save(out / f'map_{args.style}.png')
    paper.resize((W2 // 2, H2 // 2), Image.LANCZOS).save(out / f'map_{args.style}_1k.png')
    print(f'存到 {out}：map_{args.style}_plain.png（{cw}x{ch}）、map_{args.style}_plain_noroute.png、map_{args.style}.png（{W2}x{H2}，同卡片框）、map_{args.style}_1k.png')


if __name__ == '__main__':
    main()
