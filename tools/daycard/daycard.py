"""一日洋蔥地圖：把一天的軌跡做成一張手繪風地圖卡。

用法（在 Onion-Map 目錄）：
  python tools/daycard/daycard.py draft   --track daycard/demo-track.json --date 2026-11-07 [--trim 300]
  python tools/daycard/daycard.py compose --date 2026-11-07 [--painted 路徑/AI畫的.png] [--name 彩鉛] [--markers sticker|numbered] [--font kai|clear|hand] [--fog 0.9]

輸出到 daycard/<date>/：
  draft.png / draft_2k.png    無字底稿（給 ChatGPT 照構圖重畫），1024x1536 與 2048x3072
  prompt.txt                  給 ChatGPT 的提示詞
  layout.json                 圖示、地名、統計、座標（compose 用）
  base_textured.png           程式材質版的底（沒有 AI 時 compose 拿它當底）
  card.png / card_1080.png    成品：加框、標題、統計、地名、羅盤、比例尺

軌跡吃 app 的存檔格式：{"points": [[t秒, lat, lng, 精度, 模式], ...]}，模式 w 走路 v 車 f 飛。
"""
import argparse, json, math, random, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops
from scipy import ndimage as ndi
from shapely.geometry import shape, Point, LineString
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely import affinity

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'sheet'))
from render_sheet import fetch, decode_mvt, TILE_URL, UA, CACHE, polys_of, lines_of, name_of, geoms_of, paste_sprite  # noqa: E402

TZ = timezone(timedelta(hours=8))
W, H, SS = 1024, 1536, 2            # AI 的直式尺寸；工作畫布放大兩倍
W2, H2, M = W * SS, H * SS, 64 * SS  # 四周留紙邊
CONTENT = (M, M, W2 - M, H2 - M)
PAPER, INK, INK_SOFT = (243, 236, 219), (46, 40, 32), (92, 82, 68)
COL_GREEN, COL_INST, COL_URBAN = (197, 213, 162), (214, 214, 172), (227, 211, 182)
COL_WATER, COL_WATER_EDGE, COL_ROAD, COL_ROUTE = (191, 214, 228), (79, 127, 165), (118, 86, 52), (168, 48, 40)
TEX, SPRITES = ROOT / 'assets' / 'textures', ROOT / 'assets' / 'sprites'
# 字體方案：clear＝思源黑體粗（標籤）＋思源宋體粗（標題、區名），開源授權，最清楚；kai＝霞鶩文楷／標楷體，有手寫味；hand＝辰宇落雁體（原本的）
import os
FONT_DIRS = [Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'Windows' / 'Fonts', Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts', ROOT / 'fonts']
SCHEMES = {
    'clear': {'title': ['SourceHanSerifTC-Heavy.otf', 'SourceHanSerifTC-Bold.otf', 'NotoSerifTC-VF.ttf', 'msjhbd.ttc'], 'place': ['SourceHanSerifTC-Bold.otf', 'NotoSerifTC-VF.ttf', 'msjhbd.ttc'],
              'label': ['SourceHanSansTC-Bold.otf', 'NotoSansTC-VF.ttf', 'msjhbd.ttc'], 'text': ['SourceHanSansTC-Medium.otf', 'NotoSansTC-VF.ttf', 'msjh.ttc']},
    'kai': {'title': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf'], 'place': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf'], 'label': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf'], 'text': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf']},
    'hand': {'title': ['ChenYuluoyan.woff2'], 'place': ['ChenYuluoyan.woff2'], 'label': ['ChenYuluoyan.woff2'], 'text': ['ChenYuluoyan.woff2']},
    # rpg＝2026-11-08 介面重設計定案：標題與區名用思源宋體粗（木刻章回感），地名與內文用霞鶩文楷
    'rpg': {'title': ['NotoSerifTC-VF.ttf', 'SourceHanSerifTC-Heavy.otf', 'msjhbd.ttc'], 'place': ['NotoSerifTC-VF.ttf', 'SourceHanSerifTC-Bold.otf', 'msjhbd.ttc'],
            'label': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf'], 'text': ['LXGWWenKai-Regular.ttf', 'kaiu.ttf']},
}
FONT_SCHEME = 'rpg'  # 多米定案：rpg（思源宋體標題＋霞鶩文楷內文）；kai 是之前整張都用楷體的版本
_font_cache = {}


def txt(d, xy, text, f, fill):
    """文楷筆畫細，加一像素描邊變粗一點"""
    d.text(xy, text, font=f, fill=fill, stroke_width=1 if FONT_SCHEME in ('kai', 'rpg') else 0, stroke_fill=fill)


def find_font(names):
    for n in names:
        for d in FONT_DIRS:
            p = d / n
            if p.exists(): return p
    raise SystemExit(f'找不到字體 {names}，裝一個或換 --font 方案')


def font(size, role='label'):
    key = (FONT_SCHEME, role, size)
    if key not in _font_cache:
        p = find_font(SCHEMES[FONT_SCHEME][role])
        f = ImageFont.truetype(str(p), size, index=0)
        if 'VF' in p.name:  # 可變字重的字型（思源宋體 VF）：標題與區名壓到最粗，其他用粗體
            try: f.set_variation_by_axes([900 if role in ('title', 'place') else 700])
            except Exception: pass
        _font_cache[key] = f
    return _font_cache[key]
DZ = 14  # OpenFreeMap 圖磚最高 z14，街道、地標、綠地都在裡面
TEX_SCALE = {'forest': 0.45, 'urban': 0.42, 'water': 0.5, 'meadow': 0.5, 'paper': 1.0}
# 地標分類 → 貼紙；順序也是「哪種地標比較值得標」
SPRITE = {'railway': 'station', 'park': 'tree-broadleaf-1', 'place_of_worship': 'temple', 'hospital': 'hospital', 'college': 'village',
          'university': 'village', 'museum': 'town', 'attraction': 'town', 'monument': 'town', 'memorial': 'town', 'library': 'town',
          'theatre': 'town', 'stadium': 'town', 'townhall': 'town', 'school': 'hamlet', 'cafe': 'hamlet', 'restaurant': 'hamlet',
          'bar': 'hamlet', 'fast_food': 'hamlet', 'bakery': 'hamlet', 'ice_cream': 'hamlet', 'lodging': 'hamlet', 'shop': 'hamlet', 'garden': 'tree-conifer-1'}
PREF = list(SPRITE)  # 停留點配對時的優先順序
# 沿路地標只挑大家認得的：捷運站、大公園、學校、博物館、景點。廟、教堂、醫院只在你真的停留時才會出現
LANDMARK = ['railway', 'park', 'museum', 'attraction', 'monument', 'memorial', 'library', 'stadium']  # 校園不當沿路地標（一堆學院、研習所），走進去才會以停留點出現
MAX_LANDMARKS = 5
CAMPUS_R = {'park': 600, 'college': 500, 'university': 500, 'school': 250, 'hospital': 300, 'stadium': 400}  # 大範圍的地標，停留點離它的「點」可以比較遠
rng = random.Random(5)


# ───────── 座標 ─────────
def world_px(lon, lat):
    n = 256 * 2 ** DZ; s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def merc(lon, lat):
    k = 20037508.34 / 180
    return lon * k, math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * k


def unmerc(x, y):
    k = 20037508.34 / 180
    return x / k, math.atan(math.exp(y / k * math.pi / 180)) * 360 / math.pi - 90


def haversine(a, b):
    R = 6371000; la1, la2 = math.radians(a[1]), math.radians(b[1]); d1 = la2 - la1; d2 = math.radians(b[0] - a[0])
    h = math.sin(d1 / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d2 / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class Frame:
    """內容框 ↔ 經緯度。內容框是卡片扣掉紙邊的區域"""
    def __init__(self, lon0, lat0, lon1, lat1):
        self.bounds = (lon0, lat0, lon1, lat1)
        self.wx0, self.wy0 = world_px(lon0, lat1); self.wx1, self.wy1 = world_px(lon1, lat0)
        self.k = (CONTENT[2] - CONTENT[0]) / (self.wx1 - self.wx0)
        self.mpp = 156543.03 * math.cos(math.radians((lat0 + lat1) / 2)) / 2 ** DZ / self.k  # 一個卡片像素幾公尺

    def px(self, lon, lat):
        wx, wy = world_px(lon, lat); return (wx - self.wx0) * self.k + CONTENT[0], (wy - self.wy0) * self.k + CONTENT[1]

    def tiles(self):
        wxa = (0 - CONTENT[0]) / self.k + self.wx0; wxb = (W2 - CONTENT[0]) / self.k + self.wx0
        wya = (0 - CONTENT[1]) / self.k + self.wy0; wyb = (H2 - CONTENT[1]) / self.k + self.wy0
        return range(int(wxa // 256), int(wxb // 256) + 1), range(int(wya // 256), int(wyb // 256) + 1)


def extent_for(lonlats, pad=0.15, min_m=1500):
    xs, ys = zip(*(merc(lo, la) for lo, la in lonlats))
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    w = max((max(xs) - min(xs)) * (1 + 2 * pad), min_m); h = max((max(ys) - min(ys)) * (1 + 2 * pad), min_m)
    aspect = (CONTENT[2] - CONTENT[0]) / (CONTENT[3] - CONTENT[1])
    if w / h > aspect: h = w / aspect
    else: w = h * aspect
    lon0, lat0 = unmerc(cx - w / 2, cy - h / 2); lon1, lat1 = unmerc(cx + w / 2, cy + h / 2)
    return Frame(lon0, lat0, lon1, lat1)


def load_tiles(fr):
    xs, ys = fr.tiles(); layers = {}
    for tx in xs:
        for ty in ys:
            tile = decode_mvt(fetch(TILE_URL.format(z=DZ, x=tx, y=ty), CACHE / 'omt' / f'{DZ}_{tx}_{ty}.pbf', UA))
            for name, layer in tile.items():
                ext = layer.get('extent', 4096); a = 256 * fr.k / ext
                xoff = (tx * 256 - fr.wx0) * fr.k + CONTENT[0]; yoff = (ty * 256 - fr.wy0) * fr.k + CONTENT[1]
                for f in layer['features']:
                    try: g = shape(f['geometry'])
                    except Exception: continue
                    layers.setdefault(name, []).append((affinity.affine_transform(g, [a, 0, 0, a, xoff, yoff]), f.get('properties', {})))
    return layers


# ───────── 軌跡 ─────────
def load_day(path, date, trim_m):
    d = json.load(open(path, encoding='utf-8')); allpts = d.get('points', [])
    days = sorted({datetime.fromtimestamp(p[0], TZ).strftime('%Y-%m-%d') for p in allpts})
    if not date: date = days[-1]
    t0 = datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=TZ).timestamp()
    pts = [p for p in allpts if t0 <= p[0] < t0 + 86400 and p[4] != 'f']
    if len(pts) < 10: sys.exit(f'{date} 只有 {len(pts)} 個點，不夠做卡')
    layer = days.index(date) + 1 if date in days else len(days)
    trimmed = 0
    if trim_m > 0 and len(pts) > 60:  # 隱私：離起點、終點 trim 公尺內的點不要（直線距離）
        a, b = (pts[0][2], pts[0][1]), (pts[-1][2], pts[-1][1])
        keep = [p for p in pts if haversine((p[2], p[1]), a) > trim_m and haversine((p[2], p[1]), b) > trim_m]
        if len(keep) > 30: trimmed = len(pts) - len(keep); pts = keep
    return date, pts, layer, trimmed


def find_stops(pts, radius=60, min_minutes=12):
    stops = []; i = 0
    while i < len(pts):
        a = (pts[i][2], pts[i][1]); j = i
        while j + 1 < len(pts) and haversine((pts[j + 1][2], pts[j + 1][1]), a) <= radius: j += 1
        if pts[j][0] - pts[i][0] >= min_minutes * 60:
            seg = pts[i:j + 1]
            stops.append({'lon': sum(p[2] for p in seg) / len(seg), 'lat': sum(p[1] for p in seg) / len(seg), 't0': pts[i][0], 't1': pts[j][0],
                          'minutes': round((pts[j][0] - pts[i][0]) / 60), 'i0': i, 'i1': j})
            i = j + 1
        else: i += 1
    return stops


def stats_of(pts, stops):
    in_stop = set()
    for s in stops: in_stop.update(range(s['i0'], s['i1'] + 1))
    # 距離用五點移動平均後的座標算，GPS 抖動才不會把公里數灌水
    sm = [(sum(q[2] for q in pts[max(0, i - 2):i + 3]) / len(pts[max(0, i - 2):i + 3]), sum(q[1] for q in pts[max(0, i - 2):i + 3]) / len(pts[max(0, i - 2):i + 3])) for i in range(len(pts))]
    dist = 0
    for i in range(1, len(pts)):
        if i in in_stop and i - 1 in in_stop: continue
        dt = pts[i][0] - pts[i - 1][0]; dd = haversine(sm[i], sm[i - 1])
        if 0 < dt <= 600 and dd / dt < 8: dist += dd
    total = pts[-1][0] - pts[0][0]; stop_s = sum(s['t1'] - s['t0'] for s in stops)
    return {'km': round(dist / 1000, 1), 'moving_min': round((total - stop_s) / 60), 'stops': len(stops),
            'start': datetime.fromtimestamp(pts[0][0], TZ).strftime('%H:%M'), 'end': datetime.fromtimestamp(pts[-1][0], TZ).strftime('%H:%M')}


# ───────── 畫圖工具 ─────────
def mask_of(geoms, size):
    im = Image.new('L', size, 0); d = ImageDraw.Draw(im)
    for g in geoms:
        for poly in geoms_of(g):
            if poly.is_empty or len(poly.exterior.coords) < 3: continue
            d.polygon([(x, y) for x, y in poly.exterior.coords], fill=255)
            for ring in poly.interiors: d.polygon([(x, y) for x, y in ring.coords], fill=0)
    return im


def tex_array(name, size, fallback):
    p = next((TEX / f'{name}{e}' for e in ('.webp', '.png') if (TEX / f'{name}{e}').exists()), None)
    if not p: return np.ones((size[1], size[0], 3), np.float32) * (np.array(fallback, np.float32) / 255)
    im = Image.open(p).convert('RGB'); s = TEX_SCALE.get(name, 1.0) * SS / 2
    im = im.resize((max(8, round(im.width * s)), max(8, round(im.height * s))), Image.LANCZOS)
    t = np.asarray(im).astype(np.float32) / 255
    return np.tile(t, (math.ceil(size[1] / t.shape[0]), math.ceil(size[0] / t.shape[1]), 1))[:size[1], :size[0]]


def dashed(d, pts, color, width, on, off):
    pos = 0.0; draw = True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-6: continue
        cur = 0.0
        while cur < L:
            step = min((on if draw else off) - pos, L - cur)
            sx, sy = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L; cur += step
            ex, ey = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L
            if draw: d.line([(sx, sy), (ex, ey)], fill=color, width=width)
            pos += step
            if pos >= (on if draw else off) - 1e-6: pos = 0.0; draw = not draw


def pencil_poly(d, pts, color, width, jit=1.6, step=40, closed=True):
    """手抖的線：把長邊切成小段，每個節點偏一點"""
    out = []
    seq = pts + [pts[0]] if closed else pts
    for (x0, y0), (x1, y1) in zip(seq, seq[1:]):
        L = math.hypot(x1 - x0, y1 - y0); n = max(1, int(L / step))
        for k in range(n): f = k / n; out.append((x0 + (x1 - x0) * f + rng.gauss(0, jit), y0 + (y1 - y0) * f + rng.gauss(0, jit)))
    out.append(seq[-1])
    d.line(out, fill=color, width=width, joint='curve')


def text_halo(d, xy, text, f, fill=INK, halo=PAPER, r=4):
    for dx in range(-r, r + 1, max(1, r)):
        for dy in range(-r, r + 1, max(1, r)):
            if dx or dy: txt(d, (xy[0] + dx, xy[1] + dy), text, f, halo)
    txt(d, xy, text, f, fill)


# ───────── 沒有紅線時的對位：用主要道路與水的形狀比對 ─────────
def structure_of_ai(src):
    """AI 彩鉛圖裡的主要道路（黃、橘）與水（藍）"""
    a = np.asarray(src.convert('RGB')).astype(np.int16); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    road = (R > 170) & (R - B > 85) & (G - B > 45)
    water = (B > R + 20) & (B > G + 5) & (B > 110)
    return road | water


def pool_max(m, f):
    h, w = m.shape[0] // f, m.shape[1] // f
    return m[:h * f, :w * f].reshape(h, f, w, f).max(axis=(1, 3))


def chamfer_fit(ai_mask, ref_mask, s_range=(1.55, 2.35), off=320):
    """找 AI 圖 → 卡片的縮放與位移（X = ox + sx·x），讓兩邊的結構互相貼近（雙向 chamfer）。粗到細三層"""
    rng_ = np.random.default_rng(1)
    def level(f, sxs, sys_, oxs, oys, npts, sigma):
        A = pool_max(ai_mask, f); Rf = pool_max(ref_mask, f)
        dA = ndi.distance_transform_edt(~A); dR = ndi.distance_transform_edt(~Rf)
        ry, rx = np.nonzero(Rf); ay, ax = np.nonzero(A)
        if len(rx) > npts: i = rng_.choice(len(rx), npts, replace=False); rx, ry = rx[i], ry[i]
        if len(ax) > npts: i = rng_.choice(len(ax), npts, replace=False); ax, ay = ax[i], ay[i]
        RX, RY = (rx + 0.5) * f, (ry + 0.5) * f; AX, AY = (ax + 0.5) * f, (ay + 0.5) * f
        HA, WA = A.shape; HR, WR = Rf.shape; oxs = np.asarray(oxs, float); oys = np.asarray(oys, float)
        best = (-1.0, None)
        for sx in sxs:
            for sy in sys_:
                px = (RX[None, :] - oxs[:, None]) / sx; py = (RY[None, :] - oys[:, None]) / sy
                ix = np.floor(px / f).astype(int); iy = np.floor(py / f).astype(int)
                okx, oky = (ix >= 0) & (ix < WA), (iy >= 0) & (iy < HA)
                d1 = dA[np.clip(iy, 0, HA - 1)[:, None, :], np.clip(ix, 0, WA - 1)[None, :, :]]
                s1 = (np.exp(-d1 / sigma) * (oky[:, None, :] & okx[None, :, :])).mean(axis=2)
                qx = oxs[:, None] + sx * AX[None, :]; qy = oys[:, None] + sy * AY[None, :]
                jx = np.floor(qx / f).astype(int); jy = np.floor(qy / f).astype(int)
                okx2, oky2 = (jx >= 0) & (jx < WR), (jy >= 0) & (jy < HR)
                d2 = dR[np.clip(jy, 0, HR - 1)[:, None, :], np.clip(jx, 0, WR - 1)[None, :, :]]
                s2 = (np.exp(-d2 / sigma) * (oky2[:, None, :] & okx2[None, :, :])).mean(axis=2)
                s = s1 + s2; k = np.unravel_index(np.argmax(s), s.shape)
                if s[k] > best[0]: best = (float(s[k]), (float(sx), float(sy), float(oxs[k[1]]), float(oys[k[0]])))
        return best
    ar = np.arange
    sc, (sx, sy, ox, oy) = level(16, ar(s_range[0], s_range[1] + 1e-9, 0.05), ar(s_range[0], s_range[1] + 1e-9, 0.05), ar(-off, off + 1, 32), ar(-off, off + 1, 32), 1500, 1.5)
    sc, (sx, sy, ox, oy) = level(8, ar(sx - 0.06, sx + 0.061, 0.01), ar(sy - 0.06, sy + 0.061, 0.01), ar(ox - 40, ox + 41, 8), ar(oy - 40, oy + 41, 8), 3000, 2.0)
    sc, (sx, sy, ox, oy) = level(4, ar(sx - 0.012, sx + 0.0121, 0.003), ar(sy - 0.012, sy + 0.0121, 0.003), ar(ox - 10, ox + 11, 2), ar(oy - 10, oy + 11, 2), 5000, 2.5)
    return sx, sy, ox, oy, sc / 2


def fit_by_structure(src, ref_path):
    ref = np.asarray(Image.open(ref_path).convert('L')) > 127
    sx, sy, ox, oy, sc = chamfer_fit(structure_of_ai(src), ref)
    print(f'  結構對位：縮放 {sx:.3f} x {sy:.3f}，位移 {ox:.0f},{oy:.0f}，貼合度 {sc:.2f}')
    if sc < 0.25: print('  結構對位：貼合度太低，放棄'); return None
    return sx, sy, ox, oy


def erase_red(src):
    """把 AI 畫的紅色路線（含白邊）抹掉：用最近的沒被遮到的顏色補，再糊一下"""
    a = np.asarray(src.convert('RGB')); ai = a.astype(np.int16); R, G, B = ai[..., 0], ai[..., 1], ai[..., 2]
    red = (R > 110) & (G < 120) & (B < 120) & (R - np.maximum(G, B) > 80)
    m = ndi.binary_dilation(red, iterations=7)
    if not m.any(): return src
    print(f'  抹掉 AI 畫的紅線（{int(red.sum())} px）')
    iy, ix = ndi.distance_transform_edt(m, return_distances=False, return_indices=True)
    filled = a[iy, ix].astype(np.float32)
    soft = ndi.gaussian_filter(filled, (2, 2, 0))
    out = np.where(m[..., None], soft, a.astype(np.float32))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def draw_route(card, pts, mpp):
    """程式畫路線：白色底、紅色虛線、每個點抖一點像手畫的"""
    r_ = random.Random(3)
    q = [(x + r_.gauss(0, 1.2), y + r_.gauss(0, 1.2)) for x, y in pts]
    lay_ = Image.new('RGBA', card.size, (0, 0, 0, 0)); d = ImageDraw.Draw(lay_)
    d.line(q, fill=(255, 252, 240, 215), width=26, joint='curve')
    dashed(d, q, (204, 32, 28, 255), 13, 32, 20)
    card.alpha_composite(lay_)


def plate(card, box, pad=9, alpha=195, radius=18):
    """字底下墊一片半透明的紙，花底上的字才看得清"""
    x0, y0, x1, y1 = int(box[0] - pad), int(box[1] - pad), int(box[2] + pad), int(box[3] + pad)
    im = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, x1 - x0 - 1, y1 - y0 - 1], radius=radius, fill=PAPER + (alpha,))
    card.alpha_composite(im, (x0, y0))


def badge(d, cx, cy, r, text, size):
    """紅圈白數字：停留點的編號"""
    d.ellipse([cx - r - 4, cy - r - 4, cx + r + 4, cy + r + 4], fill=(255, 252, 240)); d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=COL_ROUTE, outline=(120, 20, 16), width=2)
    f = font(size, 'label'); tw, th, top = text_size(f, text)
    d.text((cx - tw / 2, cy - th / 2 - top), text, font=f, fill=(255, 250, 240), stroke_width=1, stroke_fill=(255, 250, 240))


def dot(d, cx, cy, r=11):
    """小圓點：沿路地標的位置"""
    d.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3], fill=(255, 252, 240)); d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK_SOFT)


def text_size(f, text): l, t, r, b = f.getbbox(text); return r - l, b - t, t


def overlaps(b, boxes): return any(not (b[2] < t[0] or b[0] > t[2] or b[3] < t[1] or b[1] > t[3]) for t in boxes)


# ───────── 底稿 ─────────
def build_base(fr, layers, textured):
    size = (W2, H2)
    water_g = unary_union(polys_of(layers.get('water', []))).buffer(0)
    green_g = unary_union(polys_of(layers.get('landcover', []), lambda p: p.get('class') in ('grass', 'wood', 'wetland')) +
                          polys_of(layers.get('park', [])) + polys_of(layers.get('landuse', []), lambda p: p.get('class') in ('cemetery', 'grass'))).buffer(0)
    inst_g = unary_union(polys_of(layers.get('landuse', []), lambda p: p.get('class') in ('university', 'college'))).buffer(0)
    water, green, inst = (np.asarray(mask_of([g], size)).astype(np.float32) / 255 for g in (water_g, green_g, inst_g))
    hard = ndi.gaussian_filter(green, 3) > 0.5  # 邊磨圓
    lab, n = ndi.label(hard); sizes = ndi.sum(hard, lab, range(1, n + 1))
    hard = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s * fr.mpp ** 2 >= 2500])  # 小於 2500 平方公尺的綠地不畫
    green = ndi.gaussian_filter(hard.astype(np.float32), 1.0)
    inst = inst * (1 - green); urban = (1 - water) * (1 - green) * (1 - inst)
    paper = tex_array('paper', size, PAPER)
    if textured:
        img = paper.copy()
        for m, name, fb, mix in ((urban, 'urban', COL_URBAN, 0.18), (inst, 'meadow', COL_INST, 0.25), (green, 'forest', COL_GREEN, 0.08), (water, 'water', COL_WATER, 0.0)):
            t = tex_array(name, size, fb) * (1 - mix) + paper * mix  # 混一點紙色，整張才不會太鮮
            img = img * (1 - m[..., None]) + t * m[..., None]
        def rim(m, px, color, alpha):
            nonlocal img
            hard = m > 0.5; e = ndi.gaussian_filter((hard & ~ndi.binary_erosion(hard, iterations=px)).astype(np.float32), 1.5)[..., None] * alpha
            img = img * (1 - e) + (np.array(color, np.float32) / 255) * e
        rim(green, 6, (60, 95, 45), 0.6); rim(urban, 5, (120, 80, 40), 0.35)
        wd = ndi.distance_transform_edt(water > 0.5)
        for d0, d1, a in ((0, 5, 0.45), (10, 14, 0.25), (22, 26, 0.14)):
            band = ndi.gaussian_filter(((wd > d0) & (wd <= d1)).astype(np.float32), 1.0)[..., None] * a
            img = img * (1 - band) + (np.array((70, 120, 170), np.float32) / 255) * band
    else:
        img = paper.copy()
        for m, col in ((urban, COL_URBAN), (inst, COL_INST), (green, COL_GREEN), (water, COL_WATER)):
            img = img * (1 - m[..., None]) + (np.array(col, np.float32) / 255) * m[..., None]
    # 內容框外面全是紙
    content = np.zeros((H2, W2), np.float32); content[CONTENT[1]:CONTENT[3], CONTENT[0]:CONTENT[2]] = 1
    img = img * content[..., None] + paper * (1 - content[..., None])
    base = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
    return base, water_g, green_g, inst_g


def draw_vectors(base, fr, layers, route_px, water_g, textured, start_px, end_px, icons):
    lay = Image.new('RGBA', base.size, (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    route = LineString(route_px); near = prep(route.buffer(150 / fr.mpp))
    # 水岸線、河
    b = water_g.boundary
    for g in (list(b.geoms) if b.geom_type == 'MultiLineString' else [b] if b.geom_type == 'LineString' else []):
        d.line(list(g.coords), fill=COL_WATER_EDGE + (230,), width=3, joint='curve')
    for g, p in lines_of(layers.get('waterway', []), lambda p: p.get('class') in ('river', 'canal', 'stream')):
        d.line(list(g.coords), fill=(108, 151, 189, 255), width=5 if p.get('class') == 'river' else 3, joint='curve')
    # 街道：幹道畫成雙線（褐色外框、紙色內芯，像鋼筆畫的路），小路單細線，小巷只畫路線附近的
    CASING = {'motorway': 16, 'trunk': 15, 'primary': 13, 'secondary': 11}; THIN = {'tertiary': 4, 'minor': 3}
    roads = [(g, p.get('class')) for g, p in lines_of(layers.get('transportation', [])) if p.get('brunnel') != 'tunnel' and (p.get('class') in CASING or p.get('class') in THIN)]
    for g, c in roads:
        if c in THIN and not (c == 'tertiary' or near.intersects(g)): continue
        if c in THIN: d.line(list(g.coords), fill=COL_ROAD + (255,), width=THIN[c], joint='curve')
    for g, c in roads:
        if c in CASING: d.line(list(g.coords), fill=COL_ROAD + (255,), width=CASING[c], joint='curve')
    for g, c in roads:
        if c in CASING: d.line(list(g.coords), fill=PAPER + (255,), width=CASING[c] - 6, joint='curve')
    # 路線：先鋪一道紙色底，紅色虛線才不會被屋頂吃掉
    d.line(route_px, fill=PAPER + (230,), width=26, joint='curve')
    dashed(d, route_px, COL_ROUTE + (255,), 13, 34, 20)
    # 畫到內容框為止，紙邊保持乾淨
    clip = Image.new('L', base.size, 0); ImageDraw.Draw(clip).rectangle(CONTENT, fill=255)
    lay.putalpha(ImageChops.multiply(lay.getchannel('A'), clip))
    base.alpha_composite(lay)
    # 貼紙：起點、終點、停留點、地標，由上往下
    sp = {p.stem: Image.open(p).convert('RGBA') for p in SPRITES.glob('*.png') if not p.name.startswith('_')}
    items = [('flag', start_px[0], start_px[1] + 6, 90), ('x-mark', end_px[0], end_px[1] + 24, 76)] + [(ic['sprite'], ic['x'], ic['y'] + 8, ic['size']) for ic in icons]
    for name, x, y, w in sorted(items, key=lambda t: t[2]): paste_sprite(base, sp, name, x, y, w, False)
    return base


# ───────── 地標與停留點 ─────────
def station_name(q):
    """捷運站的名字跟公園同名（大安森林公園）分不清，補個「站」"""
    nm = q['name']
    return nm + '站' if q['cls'] == 'railway' and not nm.endswith('站') else nm


def pick_names(fr, layers, pts, stops, route_px, green_g, inst_g):
    pois = []
    for g, p in layers.get('poi', []):
        nm = name_of(p)
        if not nm or g.geom_type != 'Point' or not (CONTENT[0] <= g.x < CONTENT[2] and CONTENT[1] <= g.y < CONTENT[3]): continue
        pois.append({'cls': p.get('class'), 'sub': p.get('subclass'), 'name': nm, 'rank': p.get('rank', 99), 'x': g.x, 'y': g.y})
    green_p, inst_p = prep(green_g), prep(inst_g)
    def dist_m(a, b): return math.hypot(a[0] - b[0], a[1] - b[1]) * fr.mpp
    icons, used = [], set()
    # 停留點：配最近的、最值得標的地標；公園、校園要真的站在裡面
    VENUE = ('cafe', 'restaurant', 'bar', 'fast_food', 'bakery', 'ice_cream', 'shop', 'library', 'museum')  # 真的會待在裡面的地方：很近就優先
    for s in stops:
        x, y = fr.px(s['lon'], s['lat']); best = None
        for q in pois:
            if q['cls'] == 'hospital' and q['sub'] == 'clinic': continue
            if q['cls'] == 'railway' and q['sub'] not in ('subway', 'station'): continue
            r = CAMPUS_R.get(q['cls'], 120); dm = dist_m((x, y), (q['x'], q['y']))
            if dm > r: continue
            if q['cls'] == 'park' and not green_p.contains(Point(x, y)): continue
            if q['cls'] in ('college', 'university') and not inst_p.contains(Point(x, y)): continue
            key = (0 if q['cls'] in VENUE and dm <= 45 else 1, PREF.index(q['cls']) if q['cls'] in PREF else 99, dm)
            if best is None or key < best[0]: best = (key, q)
        if best:
            q = best[1]; used.add(q['name'])
            icons.append({'kind': 'stop', 'x': x, 'y': y, 'name': station_name(q), 'sprite': SPRITE.get(q['cls'], 'hamlet'), 'size': 128, 'minutes': s['minutes'],
                          't0': datetime.fromtimestamp(s['t0'], TZ).strftime('%H:%M')})
        else:
            icons.append({'kind': 'stop', 'x': x, 'y': y, 'name': f'停留 {s["minutes"]} 分', 'sprite': 'tent', 'size': 110, 'minutes': s['minutes'],
                          't0': datetime.fromtimestamp(s['t0'], TZ).strftime('%H:%M')})
    # 沿路地標：離路線近、分類重要，最多六個，彼此隔開
    route = LineString(route_px); cands = []
    for q in pois:
        if q['cls'] not in LANDMARK or q['name'] in used: continue
        if len(q['name']) > 8 or any(w in q['name'] for w in ('分部', '本部', '分校', '推廣', '辦公室', '中心')): continue  # 機構的分部、太長的名字不是地標
        if inst_p.contains(Point(q['x'], q['y'])): continue  # 校園裡的館、廳、學院都不算：校園本身走進去就是停留點
        if q['cls'] == 'hospital' and q['sub'] == 'clinic': continue
        if q['cls'] == 'railway' and q['sub'] not in ('subway', 'station'): continue
        if q['cls'] == 'park':  # 小公園不標：看它所在的綠地有多大
            inside = [g for g in geoms_of(green_g) if g.contains(Point(q['x'], q['y']))]
            if not inside or inside[0].area * fr.mpp ** 2 < 20000: continue
        dm = route.distance(Point(q['x'], q['y'])) * fr.mpp
        if dm > 350: continue
        cands.append(((LANDMARK.index(q['cls']), dm), q))
    cands.sort(key=lambda t: t[0])
    for _, q in cands:
        if len([i for i in icons if i['kind'] == 'landmark']) >= MAX_LANDMARKS: break
        if any(math.hypot(q['x'] - i['x'], q['y'] - i['y']) < 150 for i in icons): continue
        if q['name'] in used: continue
        used.add(q['name']); icons.append({'kind': 'landmark', 'x': q['x'], 'y': q['y'], 'name': station_name(q), 'sprite': SPRITE.get(q['cls'], 'town'), 'size': 100})
    # 行政區名：內容框裡的區，最多三個，離得開
    places = []
    for g, p in layers.get('place', []):
        nm = name_of(p)
        if p.get('class') not in ('suburb', 'quarter', 'neighbourhood') or not nm or g.geom_type != 'Point': continue
        if not (CONTENT[0] + 120 <= g.x < CONTENT[2] - 120 and CONTENT[1] + 200 <= g.y < CONTENT[3] - 200): continue
        places.append({'x': g.x, 'y': g.y, 'name': nm, 'cls': p.get('class')})
    places.sort(key=lambda q: (q['cls'] != 'suburb', q['name']))
    chosen = []
    for q in places:
        if len(chosen) >= 3: break
        if any(math.hypot(q['x'] - c['x'], q['y'] - c['y']) < 500 for c in chosen): continue
        chosen.append(q)
    # 標題用的地點：停留時間加權的中心最近的區；城市找最近的 city
    if stops:
        wsum = sum(s['minutes'] for s in stops) or 1
        cx = sum(fr.px(s['lon'], s['lat'])[0] * s['minutes'] for s in stops) / wsum; cy = sum(fr.px(s['lon'], s['lat'])[1] * s['minutes'] for s in stops) / wsum
    else: cx, cy = route.centroid.x, route.centroid.y
    subs = [(math.hypot(g.x - cx, g.y - cy), name_of(p)) for g, p in layers.get('place', []) if p.get('class') == 'suburb' and name_of(p) and g.geom_type == 'Point']
    cities = [(math.hypot(g.x - cx, g.y - cy), name_of(p)) for g, p in layers.get('place', []) if p.get('class') in ('city', 'town') and name_of(p) and g.geom_type == 'Point']
    district = min(subs)[1] if subs else ''
    city = min(cities)[1] if cities else ''
    if not city:  # 卡片範圍裡沒有市名的點，抓一張 z11 圖磚找最近的市
        lon, lat = (fr.bounds[0] + fr.bounds[2]) / 2, (fr.bounds[1] + fr.bounds[3]) / 2
        n = 2 ** 11; tx = int((lon + 180) / 360 * n); la = math.radians(lat); ty = int((1 - math.log(math.tan(la) + 1 / math.cos(la)) / math.pi) / 2 * n)
        tile = decode_mvt(fetch(TILE_URL.format(z=11, x=tx, y=ty), CACHE / 'omt' / f'11_{tx}_{ty}.pbf', UA))
        best = None
        for f in tile.get('place', {}).get('features', []):
            p = f['properties']
            if p.get('class') == 'city' and name_of(p):
                g = f['geometry']['coordinates']; dd = (g[0] - (lon + 180) / 360 * 4096 * n % 4096) ** 2
                if best is None or p.get('rank', 99) < best[0]: best = (p.get('rank', 99), name_of(p))
        city = best[1] if best else ''
    return icons, chosen, district, city


# ───────── 加框 ─────────
def fit_by_route(src, lay):
    """AI 畫的圖不一定跟底稿同框（可能拿 map_osm_plain 去畫、被裁、被拉），用紅色路線對位：
    找圖裡的紅線框住的範圍，對到 layout.json 裡路線的範圍，算出每軸的縮放與位移。對不到就回 None"""
    a = np.asarray(src).astype(np.int16); R, G, B = a[..., 0], a[..., 1], a[..., 2]
    red = (R > 110) & (G < 120) & (B < 120) & (R - np.maximum(G, B) > 80)  # 亮紅、暗紅都算；橘色大路（G 高）、褐色屋頂（紅度低）不算
    lab, n = ndi.label(red)
    if not n: return None
    sizes = ndi.sum(red, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 0.02 * sizes.max()])
    def bbox(m):
        ys, xs = np.nonzero(m); return np.percentile(xs, 0.3), np.percentile(xs, 99.7), np.percentile(ys, 0.3), np.percentile(ys, 99.7)
    full = bbox(keep)
    # 線有粗細、端點有圓點：剝兩圈再量比較接近中心線，但虛線太細會被剝光，剝完框縮太多就改用原框往內收一點
    er = ndi.binary_erosion(keep, iterations=2)
    use = full
    if er.sum() > 200:
        e = bbox(er)
        if (e[1] - e[0]) > 0.93 * (full[1] - full[0]) and (e[3] - e[2]) > 0.93 * (full[3] - full[2]): use = e
    if use is full: use = (full[0] + 3, full[1] - 3, full[2] + 3, full[3] - 3)
    ax0, ax1, ay0, ay1 = use
    rx = [p[0] for p in lay['route']]; ry = [p[1] for p in lay['route']]
    rx0, rx1, ry0, ry1 = min(rx), max(rx), min(ry), max(ry)
    if ax1 - ax0 < 50 or ay1 - ay0 < 50: return None
    sx, sy = (rx1 - rx0) / (ax1 - ax0), (ry1 - ry0) / (ay1 - ay0)
    if not 0.88 < sx / sy < 1.08: print(f'  紅線對位：兩軸縮放差太多（{sx:.3f} vs {sy:.3f}），放棄'); return None
    return sx, sy, rx0 - ax0 * sx, ry0 - ay0 * sy


def cloud_noise(h, w, sigma, seed):
    r = np.random.default_rng(seed)
    n = ndi.gaussian_filter(r.standard_normal((h // 4 + 2, w // 4 + 2)).astype(np.float32), sigma / 4)
    n = ndi.zoom(n, 4, order=1)[:h, :w]
    return (n - n.mean()) / (n.std() + 1e-6)


def apply_fog(card, lay, strength, radius_m, stop_m):
    """回傳 (蓋了霧的卡, 揭開遮罩 0..1)。遮罩：路線粗線 ∪ 停留點圓 → 模糊 → 加低頻雜訊讓邊緣不規則"""
    mpp = lay['mpp']; rp, sp_ = radius_m / mpp, stop_m / mpp
    m = Image.new('L', (W2, H2), 0); dm = ImageDraw.Draw(m)
    pts = [tuple(p) for p in lay['route']]
    dm.line(pts, fill=255, width=int(2 * rp), joint='curve')
    for x, y in (pts[0], pts[-1]): dm.ellipse([x - rp, y - rp, x + rp, y + rp], fill=255)
    for ic in lay['icons']:
        if ic['kind'] == 'stop': dm.ellipse([ic['x'] - sp_, ic['y'] - sp_, ic['x'] + sp_, ic['y'] + sp_], fill=255)
    a = np.asarray(m).astype(np.float32) / 255
    a = ndi.gaussian_filter(a, 18) + 0.22 * cloud_noise(H2, W2, 70, 21)  # 羽化 + 撕邊
    reveal = np.clip((a - 0.38) / 0.24, 0, 1); reveal = reveal * reveal * (3 - 2 * reveal)
    # 霧：深藍灰，雲紋明暗，細顆粒
    big = cloud_noise(H2, W2, 160, 5); mid = cloud_noise(H2, W2, 40, 6); fine = np.random.default_rng(9).standard_normal((H2, W2)).astype(np.float32)
    lum = np.clip(0.5 + 0.22 * big + 0.1 * mid + 0.025 * fine, 0, 1)[..., None]
    fogc = np.array([[20, 24, 34]], np.float32) * (1 - lum) + np.array([[64, 70, 88]], np.float32) * lum
    img = np.asarray(card.convert('RGB')).astype(np.float32)
    k = (1 - reveal) * strength
    # AI 有時會自己多畫一段路線（把迴圈補起來）；霧裡的紅線一律蓋死，透出來會像真的走過
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    red = (R > 110) & (G < 120) & (B < 120) & (R - np.maximum(G, B) > 80)
    red = ndi.binary_dilation(red, iterations=7)  # 連紅線旁邊的白邊一起蓋
    k = np.where(red, np.maximum(k, (1 - reveal) * 0.995), k)[..., None]
    out = img * (1 - k) + fogc * k
    # 霧邊一圈淡淡的暗，像燒焦的紙邊
    edge = np.exp(-((reveal - 0.5) ** 2) / 0.02)[..., None] * 0.22
    out = out * (1 - edge)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert('RGBA'), reveal


BACKING = (244, 238, 224)  # 撕邊外面的底色（框是 AI 產的透明 PNG 時）


def apply_png_frame(card, lay, reveal, path):
    """多米用 AI 產的透明邊框：把內容框裡的地圖等比放進框的窗、疊上框，layout 的座標跟著搬，之後寫字都用新座標。
    回傳 (新卡, 新 layout, 新 reveal, 框資訊)。板子位置不看框，固定在 UI_* 那四個數字（見 make_picker）。"""
    sys.path.insert(0, str(ROOT / 'tools' / 'daycard'))
    from overlay_frame import find_window, fix_inner  # noqa: E402
    p = Path(path)
    if not p.exists(): p = ROOT / 'assets' / 'frames' / (p.stem + '.png')
    fr = fix_inner(Image.open(p).convert('RGBA'), 'shadow')
    l, t, r, b = find_window(fr); kx, ky = W2 / fr.width, H2 / fr.height
    win = (round(l * kx), round(t * ky), round(r * kx), round(b * ky)); ww, wh = win[2] - win[0], win[3] - win[1]
    content = card.crop(CONTENT); s = max(ww / content.width, wh / content.height)
    sw, sh = round(content.width * s), round(content.height * s); ox, oy = (sw - ww) // 2, (sh - wh) // 2
    out = Image.new('RGBA', (W2, H2), BACKING + (255,))
    out.paste(content.resize((sw, sh), Image.LANCZOS).crop((ox, oy, ox + ww, oy + wh)), (win[0], win[1]))
    out.alpha_composite(fr.resize((W2, H2), Image.LANCZOS))
    T = lambda x, y: ((x - CONTENT[0]) * s - ox + win[0], (y - CONTENT[1]) * s - oy + win[1])
    for ic in lay['icons']: ic['x'], ic['y'] = T(ic['x'], ic['y']); ic['size'] = ic['size'] * s
    for q in lay['places']: q['x'], q['y'] = T(q['x'], q['y'])
    lay['route'] = [list(T(x, y)) for x, y in lay['route']]; lay['start'] = list(T(*lay['start'])); lay['end'] = list(T(*lay['end'])); lay['mpp'] = lay['mpp'] / s
    if reveal is not None:
        rim = Image.fromarray((reveal * 255).astype(np.uint8)).crop(CONTENT).resize((sw, sh), Image.BILINEAR).crop((ox, oy, ox + ww, oy + wh))
        full = Image.new('L', (W2, H2), 0); full.paste(rim, (win[0], win[1])); reveal = np.asarray(full).astype(np.float32) / 255
    print(f'  邊框 {p.name}：窗 {win}，地圖放大 {s:.3f}')
    return out, lay, reveal, {'window': win}


# UI 層（標題帶、行程表、統計板、比例尺）壓在最上面，位置固定、不管哪款框都一樣（多米定案 2026-11-08）。
# 數字是 1080×1620 輸出圖上的像素：左右內縮 110、上緣 200、下緣 1420，剛好避開最厚的框（城堡）的石牆與 IG 4:5 的裁切線。
UI_LEFT, UI_TOP, UI_RIGHT, UI_BOTTOM = 110, 200, 970, 1420


def make_picker(fz):
    """回傳 pick(name, w, h, anchor, boxes)：用 PNG 框時給固定位置；沒用框就回 None，呼叫端用程式框的預設位置。"""
    kx, ky = W2 / 1080, H2 / 1620
    L, T, R, B = UI_LEFT * kx, UI_TOP * ky, UI_RIGHT * kx, UI_BOTTOM * ky
    def pick(name, w, h, anchor, boxes):
        if not fz: return None
        x = L if anchor in ('tl', 'bl') else R - w
        y = T if anchor == 'tl' else B - h
        return int(x), int(y)
    return pick


def compose(out, painted_path, name=None, frame=True, icons=True, fit='auto', mat=0, fog=0.0, fog_radius=150, fog_stop=250, route='program', markers='sticker', frame_png=None):
    lay = json.load(open(out / 'layout.json', encoding='utf-8'))
    src = Image.open(painted_path if painted_path else out / 'base_textured.png').convert('RGB')
    paper = Image.fromarray((tex_array('paper', (W2, H2), PAPER) * 255).astype(np.uint8))
    placed, has_red = None, False
    if painted_path and fit in ('auto', 'red') and 'route' in lay:
        placed = fit_by_route(src, lay); has_red = placed is not None
    if painted_path and placed is None and fit in ('auto', 'structure') and (out / 'structure.png').exists():
        placed = fit_by_structure(src, out / 'structure.png')
    if painted_path and route == 'program': src = erase_red(src)  # 路線程式畫：AI 圖上若有紅線先抹掉（沒有就原樣）
    if placed:
        sx, sy, ox, oy = placed
        print(f'  套用：縮放 {sx:.3f} x {sy:.3f}，位移 {ox:.0f},{oy:.0f}（圖 {src.width}x{src.height} → {src.width * sx:.0f}x{src.height * sy:.0f}）')
        scaled = src.resize((max(1, round(src.width * sx)), max(1, round(src.height * sy))), Image.LANCZOS)
        card = paper.copy(); card.paste(scaled, (round(ox), round(oy)))
    else:
        if painted_path and fit == 'auto': print('  紅線對位失敗，當作跟底稿同框')
        card = src.resize((W2, H2), Image.LANCZOS) if src.size != (W2, H2) else src.copy()
    card = card.convert('RGBA')
    sp = {p.stem: Image.open(p).convert('RGBA') for p in SPRITES.glob('*.png') if not p.name.startswith('_')}
    stickers = painted_path and icons and markers == 'sticker'
    stops_sorted = sorted([ic for ic in lay['icons'] if ic['kind'] == 'stop'], key=lambda i: i['t0'])
    if painted_path and route == 'program': draw_route(card, [tuple(p) for p in lay['route']], lay['mpp'])
    if stickers:  # AI 從地圖原圖畫的沒有我們的圖示，補上去（從底稿畫的就用 --no-icons）
        for ic in sorted(lay['icons'], key=lambda i: i['y']): paste_sprite(card, sp, ic['sprite'], ic['x'], ic['y'] + 8, ic['size'], False)
    if painted_path and route == 'program':  # 起點旗、終點 X 最後畫，不被停留點的圖示蓋住
        paste_sprite(card, sp, 'flag', lay['start'][0] + 14, lay['start'][1] + 6, 90 if stickers else 72, False); paste_sprite(card, sp, 'x-mark', lay['end'][0], lay['end'][1] + 24, 76, False)
    # 戰爭迷霧：走過的路左右各 fog_radius 公尺、停留點周圍 fog_stop 公尺挖開，其餘蓋深色雲霧，透一點點出來
    reveal = None
    if fog > 0:
        card, reveal = apply_fog(card, lay, fog, fog_radius, fog_stop)
    # 內容框外面鋪回紙，AI 畫到邊的也會被裱起來；mat：AI 圖自己畫了撕邊或黑角、落在內容框裡面時，紙邊再往內裱幾十像素蓋掉
    fz = None
    if frame_png:  # 多米的透明 PNG 框：地圖進窗、疊框，之後的座標都換成窗裡的
        card, lay, reveal, fz = apply_png_frame(card, lay, reveal, frame_png); frame = False
    elif frame:
        band = Image.new('L', (W2, H2), 255); ImageDraw.Draw(band).rectangle([CONTENT[0] + mat, CONTENT[1] + mat, CONTENT[2] - mat, CONTENT[3] - mat], fill=0)
        card.paste(paper, (0, 0), band)
    d = ImageDraw.Draw(card)
    # 亮度圖：挑板子位置用（越暗越好），也用來判斷 AI 圖自己畫的霧（沒開程式迷霧時，霧裡的字要換淡色）
    lum = ndi.uniform_filter(np.asarray(card.convert('L')).astype(np.float32), 61)
    pick = make_picker(fz)
    def in_light(x, y):  # 這一點是「去過的亮處」嗎：有程式迷霧看 reveal；AI 圖自己畫了霧（像迷霧城市那張）就看亮度
        xi, yi = min(W2 - 1, max(0, int(x))), min(H2 - 1, max(0, int(y)))
        if reveal is not None: return reveal[yi, xi] > 0.5
        return lum[yi, xi] > 105 if painted_path else True
    # 對位檢查圖：我們的路線畫在 AI 圖上，看有沒有對上
    chk = card.copy(); dc = ImageDraw.Draw(chk); dc.line([tuple(p) for p in lay['route']], fill=(0, 90, 255), width=6)
    chk.convert('RGB').resize((W2 // 2, H2 // 2), Image.LANCZOS).save(out / f'{name or "card"}_check.png')
    if painted_path and markers == 'numbered':  # 編號版：停留點紅圈數字，沿路地標小圓點，名字集中到行程表
        for ic in lay['icons']:
            if ic['kind'] == 'landmark' and in_light(ic['x'], ic['y']): dot(d, ic['x'], ic['y'])  # 霧裡的地標不點，不然會多一顆沒名字的點
        for n, ic in enumerate(stops_sorted, 1): badge(d, ic['x'], ic['y'], 34, str(n), 44)
    # 邊框：雙線，手抖
    o = M * 0.5
    if frame:
        pencil_poly(d, [(o, o), (W2 - o, o), (W2 - o, H2 - o), (o, H2 - o)], INK, 5)
        pencil_poly(d, [(o + 14, o + 14), (W2 - o - 14, o + 14), (W2 - o - 14, H2 - o - 14), (o + 14, H2 - o - 14)], INK, 2)
        for cx, cy in ((o + 14, o + 14), (W2 - o - 14, o + 14), (o + 14, H2 - o - 14), (W2 - o - 14, H2 - o - 14)):  # 角落小花
            for k in (18, 30): d.ellipse([cx - k, cy - k, cx + k, cy + k], outline=INK, width=2)
    boxes = []
    def cartouche(x, y, w, h):
        card.paste(paper.crop((x, y, x + w, y + h)), (x, y))
        pencil_poly(d, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], INK, 4); pencil_poly(d, [(x + 8, y + 8), (x + w - 8, y + 8), (x + w - 8, y + h - 8), (x + 8, y + h - 8)], INK, 2)
        boxes.append([x, y, x + w, y + h])
    # 標題
    title = f'{lay["city"]} · {lay["district"]}'.strip(' ·'); sub = f'{lay["date_zh"]}　洋蔥第 {lay["layer"]} 層'
    f1, f2 = font(88, 'title'), font(42, 'text'); tw1, th1, top1 = text_size(f1, title); tw2, th2, top2 = text_size(f2, sub)
    bw, bh = max(tw1, tw2) + 100, 60 + th1 + 28 + th2 + 50; bx, by = pick('title', bw, bh, 'tl', boxes) or (CONTENT[0] + 36, CONTENT[1] + 36)
    cartouche(bx, by, bw, bh)
    txt(d, (bx + 50, by + 50 - top1), title, f1, INK); txt(d, (bx + 52, by + 50 + th1 + 28 - top2), sub, f2, INK_SOFT)
    # 統計
    st = lay['stats']; line1 = f'{st["km"]} km　走了 {st["moving_min"] // 60} 小時 {st["moving_min"] % 60} 分'; line2 = f'{st["start"]} 到 {st["end"]}　停留 {st["stops"]} 處'
    f3 = font(40, 'text'); tw3, th3, top3 = text_size(f3, line1); tw4, th4, top4 = text_size(f3, line2)
    bw2 = max(tw3, tw4) + 90; bh2 = 40 + th3 + 22 + th4 + 40
    bx2, by2 = pick('stats', bw2, bh2, 'br', boxes) or (CONTENT[2] - 36 - bw2, CONTENT[3] - 36 - bh2)
    cartouche(bx2, by2, bw2, bh2)
    txt(d, (bx2 + 45, by2 + 40 - top3), line1, f3, INK); txt(d, (bx2 + 45, by2 + 40 + th3 + 22 - top4), line2, f3, INK_SOFT)
    # 羅盤（右上）。PNG 框多半自己有羅盤或角花，就不畫
    if not fz:
        cx, cy, R = CONTENT[2] - 36 - 110, CONTENT[1] + 36 + 110, 78
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=PAPER, outline=INK, width=3); d.ellipse([cx - R * 0.8, cy - R * 0.8, cx + R * 0.8, cy + R * 0.8], outline=INK, width=1)
        for k in range(16):
            a = k * math.pi / 8; l = R * 0.1 if k % 4 else R * 0.18
            d.line([(cx + math.cos(a) * R * 0.8, cy + math.sin(a) * R * 0.8), (cx + math.cos(a) * (R * 0.8 - l), cy + math.sin(a) * (R * 0.8 - l))], fill=INK, width=2)
        d.polygon([(cx, cy - R * 0.92), (cx - R * 0.16, cy), (cx + R * 0.16, cy)], fill=INK); d.polygon([(cx, cy + R * 0.92), (cx - R * 0.16, cy), (cx + R * 0.16, cy)], outline=INK)
        d.polygon([(cx - R * 0.7, cy), (cx, cy - R * 0.12), (cx, cy + R * 0.12)], outline=INK); d.polygon([(cx + R * 0.7, cy), (cx, cy - R * 0.12), (cx, cy + R * 0.12)], outline=INK)
        fn = font(44); text_halo(d, (cx - 12, cy - R - 54), 'N', fn)
        boxes.append([cx - R - 10, cy - R - 60, cx + R + 10, cy + R + 10])
    # 行程表（左下，編號版）：每個停留點一行
    if painted_path and markers == 'numbered' and stops_sorted:
        fl = font(40, 'text'); rows = [f'{ic["t0"]}　{ic["name"]}　{ic["minutes"]} 分' for ic in stops_sorted]
        tw = max(text_size(fl, r)[0] for r in rows); lh = 64
        bw3, bh3 = tw + 150, 36 + lh * len(rows) + 24; bx3, by3 = pick('legend', bw3, bh3, 'bl', boxes) or (CONTENT[0] + 36, CONTENT[3] - 36 - bh3)
        cartouche(bx3, by3, bw3, bh3)
        for i, (ic, r) in enumerate(zip(stops_sorted, rows)):
            cy_ = by3 + 36 + lh * i + lh / 2; badge(d, bx3 + 62, cy_, 22, str(i + 1), 32)
            _, th_, top_ = text_size(fl, r); txt(d, (bx3 + 104, cy_ - th_ / 2 - top_), r, fl, INK)
    # 比例尺：放在統計框上面
    mpp = lay['mpp']; L = next(v for v in (2000, 1000, 500, 250, 200, 100) if v / mpp <= (CONTENT[2] - CONTENT[0]) / 4)
    sx, sy, sw = bx2 + 45, by2 - 64, L / mpp
    for k in range(4): d.rectangle([sx + sw * k / 4, sy, sx + sw * (k + 1) / 4, sy + 14], fill=INK if k % 2 == 0 else PAPER, outline=INK, width=2)
    fs = font(36); text_halo(d, (sx - 8, sy - 50), '0', fs); text_halo(d, (sx + sw - 26, sy - 50), f'{L} m' if L < 1000 else f'{L // 1000} km', fs)
    boxes.append([sx - 20, sy - 56, sx + sw + 80, sy + 24])
    # 地名：候選位置一個個試，放得下就寫；避開框、圖示、已經寫的字。一般標籤底下墊紙片，區名拉字距只用描邊
    def try_place(text, f, cands, fill, spaced=False, with_plate=True, halo=PAPER):
        if spaced:
            widths = [text_size(f, ch)[0] for ch in text]; gap = f.size * 0.55; tw = sum(widths) + gap * (len(text) - 1); th = f.size
        else: tw, th, top = text_size(f, text)
        for lx, ty in cands:
            bb = [lx, ty, lx + tw, ty + th]
            if not (CONTENT[0] < bb[0] and bb[2] < CONTENT[2] and CONTENT[1] < bb[1] and bb[3] < CONTENT[3]): continue
            if overlaps([bb[0] - 6, bb[1] - 6, bb[2] + 6, bb[3] + 6], boxes): continue
            if spaced:
                cx_ = lx
                for ch, w in zip(text, widths): text_halo(d, (cx_, ty - text_size(f, ch)[2]), ch, f, fill=fill, halo=halo, r=5); cx_ += w + gap
            else:
                if with_plate: plate(card, bb); txt(d, (lx, ty - top), text, f, fill)
                else: text_halo(d, (lx, ty - top), text, f, fill=fill, halo=halo)
            boxes.append(bb); return True
        return False
    def icon_box(ic):  # 圖示在地圖上佔的框：貼紙以底邊中點為錨；編號版是圓
        x, y, s = ic['x'], ic['y'], ic['size']
        if markers == 'numbered': r = 40 if ic['kind'] == 'stop' else 16; return [x - r, y - r, x + r, y + r]
        return [x - s / 2, y - 0.9 * s, x + s / 2, y + 10]
    for ic in lay['icons']: boxes.append(icon_box(ic))
    # 行政區名先放（大、拉字距），地標的字再閃它；在霧裡的區名用淡灰字，像沒去過的地方的名字
    for q in lay['places']:
        f = font(70, 'place'); widths = [text_size(f, ch)[0] for ch in q['name']]; tw = sum(widths) + 70 * 0.55 * (len(q['name']) - 1)
        lit = in_light(q['x'], q['y'])
        try_place(q['name'], f, [(q['x'] - tw / 2, q['y'] - 35 + dy) for dy in (0, -140, 140, -280, 280)], (80, 70, 56) if lit else (150, 156, 170), spaced=True, halo=PAPER if lit else (40, 44, 56))
    # 停留點的字大、墊紙片；沿路地標的字小一號、只描邊，看起來退後一層。編號版的停留點名字在行程表，地圖上不重複寫
    for ic in sorted(lay['icons'], key=lambda i: i['kind'] != 'stop'):
        if not in_light(ic['x'], ic['y']): continue  # 在霧裡的就不標了
        if markers == 'numbered' and ic['kind'] == 'stop': continue
        is_stop = ic['kind'] == 'stop'
        label = f'{ic["name"]}　{ic["t0"]}' if is_stop else ic['name']
        f = font(62 if is_stop else 42, 'label'); tw, th, _ = text_size(f, label); x, y = ic['x'], ic['y']
        ib = icon_box(ic); my = (ib[1] + ib[3]) / 2
        cands = [(x - tw / 2, ib[3] + 10), (x - tw / 2, ib[1] - th - 10), (ib[2] + 12, my - th / 2), (ib[0] - 12 - tw, my - th / 2),
                 (x + 10, ib[3] + 10), (x - tw - 10, ib[3] + 10)]
        try_place(label, f, cands, INK if is_stop else (70, 62, 52), with_plate=is_stop)
    # 紙的顆粒壓在最上面，字和圖才像同一張紙
    arr = np.asarray(card.convert('RGB')).astype(np.float32)
    g = tex_array('paper', (W2, H2), PAPER).mean(axis=2); lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    arr = arr * (0.93 + 0.07 * np.clip((g - lo) / (hi - lo + 1e-6), 0, 1))[..., None]
    final = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    stem = name or 'card'
    final.save(out / f'{stem}.png'); final.resize((1080, 1620), Image.LANCZOS).save(out / f'{stem}_1080.png')
    print(f'{stem}.png / {stem}_1080.png 存好', '（AI 版）' if painted_path else '（程式材質版）')


# ───────── 主流程 ─────────
PROMPT = """第一張是地圖底稿，第二張是風格參考。請把第一張重畫成第二張的畫風：色鉛筆、墨線、舊紙，像探險日誌裡的一頁。
構圖、綠地、水、街道、紅色虛線路線、所有圖示的位置全部保持原樣，不要新增、不要移動、不要省略。
土黃色區塊畫成密密的老城屋頂，綠色畫成樹林和草地，藍色畫成水，褐色線是街道，紅色虛線是當天走過的路，要畫得清楚。
四周留白的紙邊保持是紙，不要畫邊框。整張圖上不要有任何文字。直式，1024×1536。
"""


# 定案畫風：彩鉛。給 AI 的是 rawmap.py 出的「沒有路線」的地圖原圖（map_osm_full_noroute_1k.png），路線由程式事後畫
PROMPT_PENCIL = """把這張地圖重畫成手繪色鉛筆風格：米白色紙，黑色細墨線勾邊，色鉛筆上色，筆觸看得見。
街區淡褐色，主要道路淡黃色與淡橘色，巷弄細線，公園和綠地畫成一叢叢綠色的樹，河和水藍色。
所有街道、街區、公園、河流的位置和形狀完全照原圖，不要新增、不要移動、不要省略。
不要畫任何路線或箭頭，不要畫任何文字、符號、圖示，不要畫邊框。直式，1024×1536，畫滿整張。
"""


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd', choices=['draft', 'compose']); ap.add_argument('--track'); ap.add_argument('--date')
    ap.add_argument('--trim', type=float, default=300); ap.add_argument('--painted'); ap.add_argument('--out')
    ap.add_argument('--name', help='輸出檔名（預設 card），同一天比好幾張 AI 圖時用')
    ap.add_argument('--no-frame', action='store_true', help='不畫我們的邊框、不裱紙邊（AI 圖自己有框時用）')
    ap.add_argument('--no-icons', action='store_true', help='不補貼紙圖示（AI 是從帶圖示的底稿畫的時用）')
    ap.add_argument('--fit', default='auto', choices=['auto', 'red', 'structure', 'same'], help='auto：有紅線用紅線對位、沒有就用道路與水的形狀對位；same：當作跟底稿同框')
    ap.add_argument('--mat', type=int, default=0, help='紙邊再往內裱幾像素（AI 圖自己有撕邊黑角跑進內容框時用，例如 48）')
    ap.add_argument('--font', default='rpg', choices=list(SCHEMES), help='字體方案：rpg 思源宋體標題＋霞鶩文楷內文（預設，2026-11-08 定案）、kai 全楷體、clear 思源、hand 辰宇落雁體')
    ap.add_argument('--frame-png', help='多米用 AI 產的透明邊框（assets/frames/ 裡的名字如 flowers，或 PNG 路徑）。有給就疊這張框、不畫程式的框；板子位置照同名 json 的保留區')
    ap.add_argument('--fog', type=float, default=0.0, help='戰爭迷霧濃度 0~1（0 關掉；0.9 = 沒走過的地方只透一成）')
    ap.add_argument('--fog-radius', type=float, default=150, help='路線左右揭開幾公尺'); ap.add_argument('--fog-stop', type=float, default=250, help='停留點周圍揭開幾公尺')
    ap.add_argument('--route', default='program', choices=['program', 'ai'], help='program：路線由程式畫（AI 畫的會先抹掉）；ai：留 AI 畫的')
    ap.add_argument('--markers', default='numbered', choices=['numbered', 'sticker'], help='numbered（預設，多米定案）：停留點紅圈數字、地標小點，名字集中在左下角行程表；sticker：貼貼紙、名字寫旁邊')
    args = ap.parse_args()
    global FONT_SCHEME; FONT_SCHEME = args.font
    if args.cmd == 'compose':
        out = Path(args.out) if args.out else ROOT / 'daycard' / args.date
        return compose(out, args.painted, name=args.name, frame=not args.no_frame, icons=not args.no_icons, fit=args.fit, mat=args.mat, fog=args.fog, fog_radius=args.fog_radius, fog_stop=args.fog_stop, route=args.route, markers=args.markers, frame_png=args.frame_png)
    date, pts, layer, trimmed = load_day(args.track, args.date, args.trim)
    out = Path(args.out) if args.out else ROOT / 'daycard' / date; out.mkdir(parents=True, exist_ok=True)
    stops = find_stops(pts); st = stats_of(pts, stops)
    print(f'{date}：{len(pts)} 點（隱私剪掉 {trimmed}），{st["km"]} km，停留 {len(stops)} 處，洋蔥第 {layer} 層')
    fr = extent_for([(p[2], p[1]) for p in pts])
    print(f'範圍 {fr.bounds}，一像素 {fr.mpp:.2f} m，內容寬 {(CONTENT[2] - CONTENT[0]) * fr.mpp / 1000:.1f} km')
    layers = load_tiles(fr); print('圖磚讀完：', {k: len(v) for k, v in layers.items() if k in ('poi', 'transportation', 'landcover', 'water', 'place')})
    route_px = [fr.px(p[2], p[1]) for p in pts]
    # 路線抽稀：相鄰點太近就省掉，虛線才不會碎
    thin = [route_px[0]]
    for q in route_px[1:]:
        if math.hypot(q[0] - thin[-1][0], q[1] - thin[-1][1]) >= 10: thin.append(q)
    base_flat, water_g, green_g, inst_g = build_base(fr, layers, textured=False)
    icons, places, district, city = pick_names(fr, layers, pts, stops, thin, green_g, inst_g)
    print('停留點：', [(i['name'], i['minutes']) for i in icons if i['kind'] == 'stop']); print('地標：', [i['name'] for i in icons if i['kind'] == 'landmark']); print('區：', [q['name'] for q in places], '｜標題', city, district)
    start_px, end_px = thin[0], thin[-1]
    draft = draw_vectors(base_flat, fr, layers, thin, water_g, False, start_px, end_px, icons)
    draft.convert('RGB').save(out / 'draft_2k.png'); draft.convert('RGB').resize((W, H), Image.LANCZOS).save(out / 'draft.png')
    base_tex, _, _, _ = build_base(fr, layers, textured=True)
    tex = draw_vectors(base_tex, fr, layers, thin, water_g, True, start_px, end_px, icons)
    tex.convert('RGB').save(out / 'base_textured.png')
    # 結構圖：主要道路＋水，給沒有紅線的 AI 圖對位用
    struct_im = Image.new('L', (W2, H2), 0); ds = ImageDraw.Draw(struct_im)
    for g, p in lines_of(layers.get('transportation', []), lambda p: p.get('class') in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary') and p.get('brunnel') != 'tunnel'):
        ds.line(list(g.coords), fill=255, width=14, joint='curve')
    for poly in geoms_of(water_g):
        if len(poly.exterior.coords) >= 3:
            ds.polygon([(x, y) for x, y in poly.exterior.coords], fill=255)
            for ring in poly.interiors: ds.polygon([(x, y) for x, y in ring.coords], fill=0)
    struct_im.save(out / 'structure.png')
    dz = datetime.strptime(date, '%Y-%m-%d')
    json.dump({'date': date, 'date_zh': f'{dz.year}.{dz.month:02d}.{dz.day:02d}', 'layer': layer, 'city': city, 'district': district, 'stats': st, 'mpp': fr.mpp,
               'bounds': fr.bounds, 'icons': icons, 'places': places, 'start': start_px, 'end': end_px, 'trimmed': trimmed, 'route': [[round(x, 1), round(y, 1)] for x, y in thin]},
              open(out / 'layout.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    (out / 'prompt.txt').write_text(PROMPT, encoding='utf-8'); (out / 'prompt_pencil.txt').write_text(PROMPT_PENCIL, encoding='utf-8')
    print('draft.png / draft_2k.png / base_textured.png / layout.json / prompt.txt 存到', out)
    compose(out, None)


if __name__ == '__main__':
    main()
