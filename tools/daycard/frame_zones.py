"""幫每一款邊框算出「程式寫字的保留區」，存成同名 json，並畫一張預覽。

框的裝飾（花、旗、羅盤、卷軸）會伸進窗裡，寫字的板子要避開。做法：
  1. 找窗（跟 overlay_frame 同一套），窗內 alpha > 40 的像素就是「有裝飾」。
  2. 五塊板子各有固定大小與一個角落：標題帶左上、圖例左下、統計右下、比例尺在統計上方、任務印在圖例與統計之間。
  3. 每塊從自己的角落出發，往裡面一格一格推（10px），推到跟裝飾、跟其他板子都不碰為止，離角落最近的位置就是答案。
  4. 全部限制在 IG 4:5 裁切的安全區內（上下各 160px 不放）。

用法（在 Onion-Map 目錄）：
  python tools/daycard/frame_zones.py assets/frames/flowers.png [--map daycard/2026-11-07/painted_fog.png] [--all]
  --all 會把 assets/frames/*.png 全部跑一遍。
輸出：assets/frames/<name>.json 與 daycard/_zones/<name>_zones.png
json 座標都是輸出圖（預設 1080x1620）的像素，compose 直接用。
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overlay_frame import find_window, fix_inner, cover  # noqa: E402

OUT_W, OUT_H = 1080, 1620
SAFE_TOP, SAFE_BOTTOM = 160, OUT_H - 160      # IG 4:5 裁掉上下各 135，再留一點
PAD = 18                                       # 板子離裝飾、離彼此的最小距離
# 板子大小（1080 寬的像素），順序就是擺放順序，後擺的要避開先擺的
ZONES = [
    ('title',  (400, 100), 'tl'),
    ('legend', (350, 206), 'bl'),
    ('stats',  (340, 128), 'br'),
    ('scale',  (200, 34),  'above:stats'),
    ('stamp',  (130, 130), 'onto:stats'),   # 印章蓋在統計板右上角，像封印壓在紙上；可以壓到板子，不可以壓到框的裝飾
]
# 推板子的代價：上面的板子寧可往右滑也不要往下掉，下面的板子寧可往中間滑也不要往上爬（字留在霧多的邊帶，別蓋到路線）
VERT_COST = 2
OPTIONS = 10          # 每塊板子除了最佳位置，再多留幾個備選，compose 時挑蓋到最暗（霧最多）的那個
COLORS = {'title': (163, 48, 40), 'legend': (75, 126, 163), 'stats': (91, 124, 71), 'scale': (126, 90, 34), 'stamp': (160, 110, 40)}
LABEL = {'title': '標題帶＋蠟封', 'legend': '圖例板', 'stats': '統計板', 'scale': '比例尺', 'stamp': '任務印'}


def occupancy(frame: Image.Image):
    """輸出尺寸的布林圖：True = 這裡有框的裝飾，不能放字。窗外一律 True。"""
    a = np.array(frame.resize((OUT_W, OUT_H), Image.BILINEAR).convert('RGBA'))[:, :, 3]
    l, t, r, b = find_window(frame)
    sx, sy = OUT_W / frame.width, OUT_H / frame.height
    win = (round(l * sx), round(t * sy), round(r * sx), round(b * sy))
    occ = np.ones((OUT_H, OUT_W), bool)
    # 只算真的畫上去的裝飾（alpha 高）；窗內緣那圈半透明暈不算，板子蓋在暈上沒關係
    occ[win[1]:win[3], win[0]:win[2]] = a[win[1]:win[3], win[0]:win[2]] > 160
    occ[:SAFE_TOP, :] = True
    occ[SAFE_BOTTOM:, :] = True
    return occ, win


def free(occ, x, y, w, h):
    x0, y0, x1, y1 = x - PAD, y - PAD, x + w + PAD, y + h + PAD
    if x0 < 0 or y0 < 0 or x1 > OUT_W or y1 > OUT_H:
        return False
    return not occ[y0:y1, x0:x1].any()


def place(occ, size, anchor, win, placed, limit=OPTIONS):
    w, h = size
    wl, wt, wr, wb = win
    span_x = range(0, 520, 10); span_y = range(0, 400, 10)
    if anchor == 'tl':
        cands = [(wl + PAD + dx, wt + PAD + dy, dx + VERT_COST * dy) for dy in span_y for dx in span_x]
    elif anchor == 'bl':
        cands = [(wl + PAD + dx, wb - PAD - h - dy, dx + VERT_COST * dy) for dy in span_y for dx in span_x]
    elif anchor == 'br':
        cands = [(wr - PAD - w - dx, wb - PAD - h - dy, dx + VERT_COST * dy) for dy in span_y for dx in span_x]
    elif anchor.startswith('above:'):
        if anchor.split(':')[1] not in placed:
            return None
        sx, sy, sw, sh = placed[anchor.split(':')[1]]
        cands = [(sx + sw - w - dx, sy - PAD - h - dy, dx + dy) for dy in range(0, 200, 10) for dx in range(0, 200, 10)]
    elif anchor.startswith('onto:'):  # 壓在某塊板子的右上角，約三分之一疊在板子上
        if anchor.split(':')[1] not in placed:
            return None
        sx, sy, sw, sh = placed[anchor.split(':')[1]]
        ox, oy = sx + sw - int(w * 0.62), sy - int(h * 0.55)
        cands = [(ox + dx, oy + dy, abs(dx) + abs(dy)) for dy in range(-120, 61, 10) for dx in range(-200, 61, 10)]
    else:  # between: 盡量貼著底邊，放在圖例與統計之間；塞不下就往上找
        if 'legend' not in placed or 'stats' not in placed:
            return None
        lx, ly, lw, lh = placed['legend']; sx, sy, sw, sh = placed['stats']
        mid = (lx + lw + sx) / 2 - w / 2
        cands = [(int(mid + dx), wb - PAD - h - dy, abs(dx) + VERT_COST * dy) for dy in range(0, 500, 10) for dx in range(-300, 301, 10)]
    cands.sort(key=lambda c: c[2])
    found = []
    may_overlap = anchor.startswith('onto:')
    for x, y, cost in cands:
        x, y = int(x), int(y)
        if not free(occ, x, y, w, h):
            continue
        if not may_overlap and any(not (x + w + PAD <= px or px + pw + PAD <= x or y + h + PAD <= py or py + ph + PAD <= y) for px, py, pw, ph in placed.values()):
            continue
        # 備選之間至少差 60px，不然全是同一個位置挪一格
        if any(abs(x - fx) < 60 and abs(y - fy) < 60 for fx, fy, _, _, _ in found):
            continue
        found.append((x, y, w, h, cost))
        if len(found) >= limit:
            break
    return found or None


def compute(frame_path: Path):
    raw = Image.open(frame_path).convert('RGBA')
    occ, win = occupancy(raw)
    frame = fix_inner(raw, 'shadow')
    spec = {name: (size, anchor) for name, size, anchor in ZONES}
    placed, options = {}, {}

    def take(name, found):
        placed[name] = found[0][:4]
        options[name] = [f[:4] for f in found]

    t = place(occ, *spec['title'], win, placed)
    if t:
        take('title', t)
    # 圖例與統計一起找：底邊常常塞不下兩塊，單獨各找會讓後找的那塊被擠到路線上。兩塊代價加總最小的組合勝出。
    L = place(occ, *spec['legend'], win, placed, limit=40)
    best = None
    for l in (L or []):
        trial = dict(placed, legend=l[:4])
        S = place(occ, *spec['stats'], win, trial, limit=1)
        if not S:
            continue
        total = l[4] + S[0][4]
        if best is None or total < best[0]:
            best = (total, l, S[0])
    if best:
        _, l, s = best
        take('legend', [l] + [o for o in L if o is not l])
        S = place(occ, *spec['stats'], win, dict(placed), limit=OPTIONS)
        take('stats', [s] + [o for o in (S or []) if o[:4] != s[:4]])
    elif L:
        take('legend', L)
        print('  stats: 放不下，compose 時略過這塊')
    for name in ('scale', 'stamp'):
        z = place(occ, *spec[name], win, placed)
        if z is None:
            print(f'  {name}: 放不下，compose 時略過這塊')
            continue
        take(name, z)
    return frame, win, placed, options


def font(size):
    for p in [Path('C:/Windows/Fonts/msjhbd.ttc'), Path('C:/Windows/Fonts/msjh.ttc')]:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def preview(frame, win, zones, map_path, out_path):
    base = Image.new('RGBA', (OUT_W, OUT_H), (244, 238, 224, 255))
    if map_path:
        painted = Image.open(map_path).convert('RGBA')
        sx, sy = frame.width / OUT_W, frame.height / OUT_H
        box = (round(win[0] * sx), round(win[1] * sy), round(win[2] * sx), round(win[3] * sy))
        canvas = Image.new('RGBA', frame.size, (244, 238, 224, 255))
        canvas.alpha_composite(cover(painted, box), (box[0], box[1]))
        canvas.alpha_composite(frame)
        base = canvas.resize((OUT_W, OUT_H), Image.LANCZOS)
    else:
        base.alpha_composite(frame.resize((OUT_W, OUT_H), Image.LANCZOS))
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([win[0], win[1], win[2] - 1, win[3] - 1], outline=(255, 255, 255, 140), width=2)
    d.line([(0, SAFE_TOP), (OUT_W, SAFE_TOP)], fill=(255, 80, 80, 160), width=2)
    d.line([(0, SAFE_BOTTOM), (OUT_W, SAFE_BOTTOM)], fill=(255, 80, 80, 160), width=2)
    f = font(22)
    for name, (x, y, w, h) in zones.items():
        c = COLORS[name]
        d.rectangle([x, y, x + w, y + h], fill=(246, 238, 219, 200), outline=c + (255,), width=3)
        d.text((x + 10, y + 8), LABEL[name], font=f, fill=c + (255,))
    base.alpha_composite(layer)
    base.convert('RGB').save(out_path, quality=92)


def run(frame_path: Path, map_path):
    print(frame_path.name)
    frame, win, zones, options = compute(frame_path)
    data = {'frame': frame_path.name, 'space': [OUT_W, OUT_H], 'window': list(win), 'inner': 'shadow',
            'zones': {k: list(v) for k, v in zones.items()},
            'options': {k: [list(o) for o in v] for k, v in options.items()},
            'note': 'zones 是預設位置；options 是同一塊板子的備選（第一個就是預設）。compose 可以照當天地圖挑蓋到最暗的那個，但要自己檢查板子之間不重疊。'}
    frame_path.with_suffix('.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    out_dir = Path('daycard/_zones'); out_dir.mkdir(parents=True, exist_ok=True)
    preview(frame, win, zones, map_path, out_dir / f'{frame_path.stem}_zones.png')
    print('  window', win, ' zones:', {k: v[:2] for k, v in zones.items()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frame', nargs='?')
    ap.add_argument('--map')
    ap.add_argument('--all', action='store_true')
    a = ap.parse_args()
    paths = sorted(Path('assets/frames').glob('*.png')) if a.all else [Path(a.frame)]
    paths = [p for p in paths if not p.stem.endswith('_shadow')]
    for p in paths:
        run(p, a.map)


if __name__ == '__main__':
    main()
