"""底稿器：讀 OpenFreeMap 向量圖磚與 terrarium 高程，挑東西，畫一張固定比例的區域圖幅底稿。

用法（在 Onion-Map 目錄）：
  python tools/sheet/render_sheet.py --sheet taipei --stats     # 只印資料統計
  python tools/sheet/render_sheet.py --sheet taipei             # 畫底稿到 sheets/taipei/

產出：
  base_flat.png   平面底稿：紙、水、市區塊、森林塊、淡淡的高程陰影、海岸線、河、幹道（給 AI 重畫用，也是路 B 的骨架）
  base_icons.png  同上加貼紙圖示、地名、邊框、標題（給人看、給 AI 當構圖）
  layout.json     每個圖示與地名的位置、尺寸，之後路 B 和切圖磚都讀這份
"""
import argparse, gzip, io, json, math, time, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely import affinity
import mapbox_vector_tile

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'tools' / 'sheet' / 'cache'
SPRITES = ROOT / 'assets' / 'sprites'
FONT = ROOT / 'fonts' / 'ChenYuluoyan.woff2'
TILE_URL = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf'
DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
UA = {'User-Agent': 'onion-map-sheet-renderer/0.1'}

SHEETS = {
    # 台北盆地＋陽明山＋北海岸，約 45 公里見方
    'taipei': {'lon0': 121.30, 'lat0': 24.88, 'lon1': 121.746, 'lat1': 25.29, 'zoom': 13, 'title': '臺北 探索地圖 v0.1'},
}
PAPER = (243, 236, 219)
INK = (46, 40, 32)
COL_WATER, COL_WATER_EDGE = (191, 214, 228), (79, 127, 165)
COL_URBAN, COL_FOREST = (227, 211, 182), (197, 213, 162)
COL_ROAD, COL_RIVER = (138, 106, 72), (108, 151, 189)


# ───────── 座標 ─────────
class Sheet:
    def __init__(self, cfg):
        self.cfg = cfg; self.z = cfg['zoom']; self.world = 256 * 2 ** self.z
        x0, y1 = self.lonlat_px(cfg['lon0'], cfg['lat0']); x1, y0 = self.lonlat_px(cfg['lon1'], cfg['lat1'])
        self.tx0, self.ty0 = int(x0 // 256), int(y0 // 256); self.tx1, self.ty1 = int(x1 // 256), int(y1 // 256)
        self.ox, self.oy = self.tx0 * 256, self.ty0 * 256
        self.W, self.H = (self.tx1 - self.tx0 + 1) * 256, (self.ty1 - self.ty0 + 1) * 256
        lat_mid = (cfg['lat0'] + cfg['lat1']) / 2
        self.mpp = 156543.03 * math.cos(math.radians(lat_mid)) / 2 ** self.z  # 一像素幾公尺

    def lonlat_px(self, lon, lat):
        s = math.sin(math.radians(lat))
        return (lon + 180) / 360 * self.world, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * self.world

    def m2px(self, m): return m / self.mpp


# ───────── 抓資料 ─────────
def fetch(url, path, headers=None):
    if path.exists(): return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=headers or {})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                if r.headers.get('Content-Encoding') == 'gzip' or data[:2] == b'\x1f\x8b': data = gzip.decompress(data)
            path.write_bytes(data); return data
        except Exception:
            if attempt == 2: raise
            time.sleep(1.5)


def decode_mvt(data):
    try:
        return mapbox_vector_tile.decode(data, default_options={'y_coord_down': True})
    except TypeError:
        return mapbox_vector_tile.decode(data, y_coord_down=True)


def load_tiles(sh, dz):
    """抓 dz 層的向量圖磚，回傳 {layer: [(shapely geom in sheet px, props)]}"""
    scale = 2 ** (sh.z - dz)  # 一張 dz 圖磚在圖幅上幾個 256 格
    layers = {}
    for tx in range(sh.tx0 // scale, sh.tx1 // scale + 1):
        for ty in range(sh.ty0 // scale, sh.ty1 // scale + 1):
            data = fetch(TILE_URL.format(z=dz, x=tx, y=ty), CACHE / 'omt' / f'{dz}_{tx}_{ty}.pbf', UA)
            tile = decode_mvt(data)
            size = 256 * scale
            for name, layer in tile.items():
                ext = layer.get('extent', 4096); a = size / ext
                xoff, yoff = tx * size - sh.ox, ty * size - sh.oy
                for f in layer['features']:
                    try:
                        g = shape(f['geometry'])
                    except Exception:
                        continue
                    g = affinity.affine_transform(g, [a, 0, 0, a, xoff, yoff])
                    layers.setdefault(name, []).append((g, f.get('properties', {})))
    return layers


def load_dem(sh, dz):
    """terrarium 高程拼成圖幅解析度的陣列（公尺）"""
    scale = 2 ** (sh.z - dz)
    tiles_x = range(sh.tx0 // scale, sh.tx1 // scale + 1); tiles_y = range(sh.ty0 // scale, sh.ty1 // scale + 1)
    mosaic = np.zeros((len(tiles_y) * 256, len(tiles_x) * 256), np.float32)
    for i, tx in enumerate(tiles_x):
        for j, ty in enumerate(tiles_y):
            data = fetch(DEM_URL.format(z=dz, x=tx, y=ty), CACHE / 'dem' / f'{dz}_{tx}_{ty}.png')
            a = np.asarray(Image.open(io.BytesIO(data)).convert('RGB')).astype(np.float32)
            mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    x0 = (sh.tx0 // scale) * scale * 256; y0 = (sh.ty0 // scale) * scale * 256
    big = ndi.zoom(mosaic, scale, order=1)
    cx, cy = sh.ox - x0, sh.oy - y0
    return big[cy:cy + sh.H, cx:cx + sh.W]


# ───────── 幾何工具 ─────────
def polys_of(items, keep=None):
    out = []
    for g, p in items:
        if keep and not keep(p): continue
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            if not g.is_valid: g = g.buffer(0)
            if not g.is_empty: out.append(g)
    return out


def lines_of(items, keep=None):
    out = []
    for g, p in items:
        if keep and not keep(p): continue
        if g.geom_type == 'LineString': out.append((g, p))
        elif g.geom_type == 'MultiLineString': out.extend((l, p) for l in g.geoms)
    return out


def geoms_of(g):
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type == 'MultiPolygon': return list(g.geoms)
    if g.geom_type == 'GeometryCollection': return [x for x in g.geoms if x.geom_type == 'Polygon']
    return []


def rasterize(geom, W, H, ss=2):
    """多邊形（含洞）→ 0..1 的浮點遮罩，超取樣兩倍做抗鋸齒"""
    im = Image.new('L', (W * ss, H * ss), 0); d = ImageDraw.Draw(im)
    for poly in geoms_of(geom):
        if poly.is_empty or len(poly.exterior.coords) < 3: continue
        d.polygon([(x * ss, y * ss) for x, y in poly.exterior.coords], fill=255)
        for ring in poly.interiors: d.polygon([(x * ss, y * ss) for x, y in ring.coords], fill=0)
    return np.asarray(im.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255


def name_of(p):
    for k in ('name:zh-Hant', 'name:zh', 'name'):
        if p.get(k): return p[k]
    return None


# ───────── 地形 ─────────
def hillshade(dem, mpp, az=315, alt=45):
    gy, gx = np.gradient(dem, mpp)
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    azr, altr = math.radians(az), math.radians(alt)
    hs = np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - aspect)
    return np.clip(hs, 0, 1)


def ridge_points(dem, sh, urban, water, sigma_m=110, pct=92):
    """山脊線上的點：高斯二階導數找「橫向彎曲最強且是局部最高」的像素，回傳 (x, y, elev, strength) 依海拔由高到低"""
    sig = sh.m2px(sigma_m)
    sm = ndi.gaussian_filter(dem, sig)
    hxx = ndi.gaussian_filter(dem, sig, order=(0, 2)); hyy = ndi.gaussian_filter(dem, sig, order=(2, 0)); hxy = ndi.gaussian_filter(dem, sig, order=(1, 1))
    tr = (hxx + hyy) / 2; det = np.sqrt(((hxx - hyy) / 2) ** 2 + hxy ** 2)
    lam = tr - det  # 最小特徵值（山脊處強負）
    vx = hxy; vy = lam - hxx  # 對應特徵向量＝橫跨山脊的方向
    n = np.hypot(vx, vy) + 1e-9; vx /= n; vy /= n
    H, W = dem.shape; yy, xx = np.mgrid[0:H, 0:W]
    step = max(2.0, sig * 0.8)
    e1 = ndi.map_coordinates(sm, [yy + vy * step, xx + vx * step], order=1, mode='nearest')
    e2 = ndi.map_coordinates(sm, [yy - vy * step, xx - vx * step], order=1, mode='nearest')
    localmax = (sm >= e1) & (sm >= e2)
    strength = -lam
    land = (sm > 120) & (urban < 0.5) & (water < 0.5)
    thr = np.percentile(strength[land], pct) if land.any() else 0
    ridge = land & localmax & (strength > thr)
    ys, xs = np.nonzero(ridge)
    order = np.argsort(-sm[ys, xs])
    return [(float(xs[i]), float(ys[i]), float(sm[ys[i], xs[i]]), float(strength[ys[i], xs[i]])) for i in order]


# ───────── 排版 ─────────
def overlaps(b, boxes):
    for t in boxes:
        if not (b[2] < t[0] or b[0] > t[2] or b[3] < t[1] or b[1] > t[3]): return True
    return False


def load_sprites():
    sp = {}
    for p in SPRITES.glob('*.png'):
        if p.name.startswith('_'): continue
        sp[p.stem] = Image.open(p).convert('RGBA')
    return sp


def paste_sprite(canvas, sp, name, x, y, w, flip=False):
    im = sp[name]; h = w * im.height / im.width
    im = im.resize((max(1, int(round(w))), max(1, int(round(h)))), Image.LANCZOS)
    if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT)
    left, top = int(round(x - w / 2)), int(round(y - h))
    cl, ct = max(0, -left), max(0, -top); cr, cb = min(im.width, canvas.width - left), min(im.height, canvas.height - top)
    if cr <= cl or cb <= ct: return
    canvas.alpha_composite(im.crop((cl, ct, cr, cb)), (left + cl, top + ct))


def dashed(d, pts, color, width, on, off):
    pos = 0.0; draw = True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0); cur = 0.0
        while cur < L:
            seg = (on if draw else off) - pos
            step = min(seg, L - cur)
            sx, sy = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L; cur += step
            ex, ey = x0 + (x1 - x0) * cur / L, y0 + (y1 - y0) * cur / L
            if draw: d.line([(sx, sy), (ex, ey)], fill=color, width=width)
            pos += step
            if pos >= (on if draw else off) - 1e-6: pos = 0.0; draw = not draw


# ───────── 主流程 ─────────
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sheet', default='taipei'); ap.add_argument('--stats', action='store_true')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    cfg = SHEETS[args.sheet]; sh = Sheet(cfg)
    out = Path(args.out) if args.out else ROOT / 'sheets' / args.sheet
    print(f'圖幅 {args.sheet}: {sh.W}x{sh.H} px，一像素 {sh.mpp:.1f} m，z{sh.z} 圖磚 x {sh.tx0}-{sh.tx1} y {sh.ty0}-{sh.ty1}')

    t = time.time(); layers = load_tiles(sh, 12); print(f'向量圖磚讀完 {time.time() - t:.1f}s：', {k: len(v) for k, v in layers.items()})
    if args.stats:
        from collections import Counter
        for name in ('place', 'landuse', 'landcover', 'park', 'mountain_peak', 'transportation', 'waterway', 'water', 'water_name', 'poi'):
            c = Counter(p.get('class') for g, p in layers.get(name, []))
            print(f'  {name}: {dict(c.most_common(12))}')
        return

    t = time.time(); dem = load_dem(sh, 12); print(f'高程讀完 {time.time() - t:.1f}s，範圍 {dem.min():.0f}~{dem.max():.0f} m')
    W, H = sh.W, sh.H
    km2 = (1000 / sh.mpp) ** 2  # 一平方公里幾像素

    # 1. 水：全部水域聯集
    water_geom = unary_union(polys_of(layers.get('water', []))).simplify(1.5)
    water = rasterize(water_geom, W, H)
    # 2. 市區塊：住宅／商業／工業聯集，閉運算 700 公尺補縫、填洞、開運算 250 公尺去毛邊，丟掉小於 1.5 平方公里的
    urban_geom = unary_union(polys_of(layers.get('landuse', []), lambda p: p.get('class') in ('residential', 'commercial', 'industrial', 'retail', 'suburb', 'neighbourhood')))
    r = sh.m2px(700); urban_geom = urban_geom.buffer(r).buffer(-r)
    r2 = sh.m2px(250); urban_geom = urban_geom.buffer(-r2).buffer(r2).simplify(2)
    urban_geom = unary_union([g for g in geoms_of(urban_geom) if g.area > km2 * 1.5])
    urban = rasterize(urban_geom, W, H)
    urban = ndi.binary_fill_holes(urban > 0.5).astype(np.float32) * (1 - water)
    urban = ndi.gaussian_filter(urban, 1.0)
    # 3. 森林塊：OSM 的樹林 ∪ 海拔 120 公尺以上的山地，扣掉市區與水，模糊後取門檻讓邊緣圓滑、小塊消失
    wood_geom = unary_union(polys_of(layers.get('landcover', []), lambda p: p.get('class') == 'wood')).simplify(1.5)
    wood = rasterize(wood_geom, W, H)
    forest_raw = np.maximum(wood, (dem > 120).astype(np.float32)) * (1 - urban) * (1 - water)
    forest = (ndi.gaussian_filter(forest_raw, sh.m2px(90)) > 0.5)
    lab, n = ndi.label(forest); sizes = ndi.sum(forest, lab, range(1, n + 1))
    forest = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > km2 * 0.6])
    forest = ndi.binary_fill_holes(forest) & (urban < 0.5) & (water < 0.5)
    forest_f = ndi.gaussian_filter(forest.astype(np.float32), 1.2)
    print(f'水 {water.sum() / km2:.0f} km²，市區 {urban.sum() / km2:.0f} km²，森林 {forest.sum() / km2:.0f} km²')

    # 4. 平面底稿
    img = np.zeros((H, W, 3), np.float32); img[:] = np.array(PAPER) / 255
    def blend(color, a):
        nonlocal img; a = a[..., None]; img = img * (1 - a) + (np.array(color) / 255) * a
    blend(COL_FOREST, forest_f); blend(COL_URBAN, urban); blend(COL_WATER, water)
    # 高程陰影只留一點點、先糊掉，像淡淡的鉛筆打底，別像衛星圖
    hs = ndi.gaussian_filter(hillshade(dem, sh.mpp), 2.5)
    shade = 1 - (1 - hs) * 0.22 * (1 - water)
    img = img * shade[..., None]
    base = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).convert('RGBA')

    # 線：海岸線、河、幹道。畫在兩倍大的透明層再縮小，線才平滑
    ss = 2
    lay = Image.new('RGBA', (W * ss, H * ss), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    def draw_lines(geom_list, color, width, dash=None):
        for g in geom_list:
            pts = [(x * ss, y * ss) for x, y in g.coords]
            if len(pts) < 2: continue
            if dash: dashed(d, pts, color, int(width * ss), dash[0] * ss, dash[1] * ss)
            else: d.line(pts, fill=color, width=int(width * ss), joint='curve')
    b = water_geom.boundary
    coast_lines = list(b.geoms) if b.geom_type == 'MultiLineString' else [b] if b.geom_type == 'LineString' else []
    draw_lines(coast_lines, COL_WATER_EDGE + (230,), 1.6)
    # 河：只畫有名字、夠長、而且不在水域多邊形裡的（大河本身已是多邊形）
    wide = prep(water_geom.buffer(2))
    rivers = [g.simplify(2) for g, p in lines_of(layers.get('waterway', []), lambda p: p.get('class') == 'river' and name_of(p)) if g.length * sh.mpp > 6000 and not wide.contains(g)]
    draw_lines(rivers, COL_RIVER + (255,), 1.8)
    roads = [g.simplify(3) for g, p in lines_of(layers.get('transportation', []), lambda p: p.get('class') in ('motorway', 'trunk'))]
    draw_lines(roads, COL_ROAD + (255,), 1.8, dash=(9, 6))
    lay = lay.resize((W, H), Image.LANCZOS)
    base.alpha_composite(lay)
    out.mkdir(parents=True, exist_ok=True)
    base.convert('RGB').save(out / 'base_flat.png'); print('base_flat.png 存好')

    # 5. 排版：城鎮先佔位 → 山沿山脊 → 地名 → 森林叢 → 海上點綴
    sp = load_sprites(); font = lambda s: ImageFont.truetype(str(FONT), s)
    def sprite_h(name, w): im = sp[name]; return w * im.height / im.width
    items, boxes = [], []          # 共用佔位表：城鎮、地名、森林叢、海上點綴
    place_boxes, label_boxes = [], []
    def add(kind, name, x, y, w, pad=0, flip=False, extra=None, check=None, into=None):
        h = sprite_h(name, w); b = [x - w / 2 - pad, y - h - pad, x + w / 2 + pad, y + pad]
        if overlaps(b, boxes if check is None else check): return None
        (boxes if into is None else into).append(b)
        it = {'kind': kind, 'name': name, 'x': round(x, 1), 'y': round(y, 1), 'w': round(w, 1), 'h': round(h, 1), 'flip': flip, 'box': [round(v, 1) for v in b]}
        if extra: it.update(extra)
        items.append(it); return it
    # 城鎮：市用城堡，區（資料裡叫 suburb）與鎮用教堂村；市先放，區彼此至少隔 3 公里
    place_size = {'city': sh.m2px(3200), 'town': sh.m2px(2000), 'suburb': sh.m2px(1600)}
    icon_of = {'city': 'city', 'town': 'town', 'suburb': 'town'}
    places = [(g, p) for g, p in layers.get('place', []) if p.get('class') in place_size and g.geom_type == 'Point' and name_of(p)]
    places.sort(key=lambda gp: ({'city': 0, 'town': 1, 'suburb': 2}[gp[1]['class']], gp[1].get('rank', 99)))
    seen, placed_towns = set(), []
    for g, p in places:
        nm, cls = name_of(p), p['class']
        if nm in seen or not (0 <= g.x < W and 0 <= g.y < H) or water[int(g.y), int(g.x)] > 0.5: continue
        seen.add(nm)
        if cls != 'city' and any((g.x - px) ** 2 + (g.y - py) ** 2 < sh.m2px(3000) ** 2 for px, py in placed_towns): continue
        it = add('place', icon_of[cls], g.x, g.y + sh.m2px(300), place_size[cls], pad=sh.m2px(200), extra={'label': nm, 'cls': cls}, into=place_boxes)
        if it: placed_towns.append((g.x, g.y)); boxes.append(it['box'])
    # 山：山脊點依海拔由高到低貪婪放。山跟山可以疊一點成山脈，不壓到城鎮。丘陵只放少數
    ridges = ridge_points(dem, sh, urban, water)
    print(f'山脊候選點 {len(ridges)}')
    placed, mount_boxes = [], []
    for x, y, e, strength in ridges:
        if forest_f[int(y), int(x)] < 0.3 and e < 400: continue
        if e > 800: name, w, k = 'mountain-high-1', sh.m2px(3600), 0.72
        elif e > 450: name, w, k = ('mountain-high-2' if (int(x) // 7) % 2 else 'mountain-1'), sh.m2px(2900), 0.72
        elif e > 280: name, w, k = 'mountain-1', sh.m2px(2300), 0.8
        elif e > 190 and (int(x * 3 + y) % 3 == 0): name, w, k = 'hill-1', sh.m2px(1800), 1.3
        else: continue
        if any((x - px) ** 2 + (y - py) ** 2 < ((w + pw) / 2 * k) ** 2 for px, py, pw in placed): continue
        h = sprite_h(name, w); yb = y + h * 0.15; b = [x - w / 2, yb - h, x + w / 2, yb]
        if overlaps(b, place_boxes): continue
        mount_boxes.append(b); placed.append((x, y, w))
        items.append({'kind': 'mountain', 'name': name, 'x': round(x, 1), 'y': round(yb, 1), 'w': round(w, 1), 'h': round(h, 1), 'flip': (int(x * 7 + y) % 2 == 0), 'ele': round(e), 'box': [round(v, 1) for v in b]})
        if len(placed) >= 240: break
    # 山放完才擋樹（框縮一點，樹可以貼到山腳）
    for b in mount_boxes: boxes.append([b[0] + 8, b[1] + (b[3] - b[1]) * 0.3, b[2] - 8, b[3] - 4])
    # 地名：城鎮名貼在圖示正下方；山名挑最高的幾座（可以壓在山上）；湖與灣的名字
    labels = []
    for it in [i for i in items if i['kind'] == 'place']:
        labels.append((it['label'], it['x'], it['box'][3] + 8, 56 if it['cls'] == 'city' else 34, 'top', 'place'))  # 要離自己的佔位框遠一點，不然被自己擋掉
    peaks = sorted([(p.get('ele') or 0, name_of(p), g) for g, p in layers.get('mountain_peak', []) if name_of(p) and g.geom_type == 'Point'], key=lambda t: -t[0])
    seen_peak, n_peak = set(), 0
    for ele, nm, g in peaks:
        if nm in seen_peak or not (0 <= g.x < W and 0 <= g.y < H): continue
        seen_peak.add(nm); labels.append((nm, g.x, g.y, 28, 'center', 'peak')); n_peak += 1
        if n_peak >= 12: break
    for g, p in layers.get('water_name', []):
        nm = name_of(p); c = g.centroid
        if nm and 0 <= c.x < W and 0 <= c.y < H: labels.append((nm, c.x, c.y, 34, 'center', 'water'))
    label_items = []
    for text, x, y, size, anchor, kind in labels:
        f = font(size); l, t_, r_, b_ = f.getbbox(text); tw, th = r_ - l, b_ - t_
        box = [x - tw / 2, y, x + tw / 2, y + th] if anchor == 'top' else [x - tw / 2, y - th / 2, x + tw / 2, y + th / 2]
        padded = [box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4]
        # 山名可以壓在山上，所以只跟地名和城鎮比；其他跟全部比
        if overlaps(padded, label_boxes + place_boxes if kind == 'peak' else boxes + label_boxes): continue
        label_boxes.append(padded); label_items.append({'text': text, 'x': round(box[0], 1), 'y': round(box[1] - t_, 1), 'size': size, 'kind': kind})
    boxes.extend(label_boxes)
    # 森林叢：森林塊裡固定格子撒，稀疏，不壓到任何東西
    step = sh.m2px(1500); rng = np.random.default_rng(7)
    for gy in np.arange(step / 2, H, step):
        for gx in np.arange(step / 2, W, step):
            x, y = gx + (rng.random() - 0.5) * step * 0.8, gy + (rng.random() - 0.5) * step * 0.8
            if not (0 <= x < W and 0 <= y < H) or forest_f[int(y), int(x)] < 0.6 or rng.random() > 0.6: continue
            name = 'forest-clump-1' if rng.random() < 0.5 else 'forest-clump-2'
            add('forest', name, x, y, sh.m2px(1400 + rng.random() * 500), pad=sh.m2px(100), flip=rng.random() < 0.5)
    # 海上點綴：離岸 1.5 公里以上的海面
    sea = ndi.distance_transform_edt(water > 0.5) > sh.m2px(1500)
    ys, xs = np.nonzero(sea)
    if len(xs):
        for k in range(16):
            i = rng.integers(len(xs)); x, y = float(xs[i]), float(ys[i])
            name = ['ship', 'sea-serpent', 'whale', 'ship'][k % 4]
            add('sea', name, x, y, sh.m2px(1600), pad=sh.m2px(1500), flip=rng.random() < 0.5)

    # 6. 圖示版。先存一張沒有地名的（給 AI 重畫用，字由程式事後貼，AI 會把字寫錯）
    icons = base.copy()
    for it in sorted(items, key=lambda i: i['y']): paste_sprite(icons, sp, it['name'], it['x'], it['y'], it['w'], it['flip'])  # 由上往下，前排蓋後排
    icons.convert('RGB').save(out / 'base_icons_nolabel.png')
    icons.convert('RGB').resize((2048, round(2048 * H / W)), Image.LANCZOS).save(out / 'base_icons_nolabel_2k.png'); print('base_icons_nolabel(_2k).png 存好')
    d = ImageDraw.Draw(icons)
    for lb in label_items:
        f = font(lb['size'])
        for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)): d.text((lb['x'] + dx, lb['y'] + dy), lb['text'], font=f, fill=PAPER)
        d.text((lb['x'], lb['y']), lb['text'], font=f, fill=INK)
    # 邊框、標題、指北
    m = 22
    d.rectangle([m, m, W - m, H - m], outline=INK, width=4); d.rectangle([m + 9, m + 9, W - m - 9, H - m - 9], outline=INK, width=2)
    f = font(64); d.text((m + 40, H - m - 110), cfg['title'] + '　' + time.strftime('%Y.%m.%d'), font=f, fill=INK)
    cx, cy, R = W - m - 110, m + 110, 60
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=INK, width=3); d.ellipse([cx - R * 0.8, cy - R * 0.8, cx + R * 0.8, cy + R * 0.8], outline=INK, width=1)
    d.polygon([(cx, cy - R * 0.9), (cx - R * 0.16, cy), (cx + R * 0.16, cy)], fill=INK)
    d.polygon([(cx, cy + R * 0.9), (cx - R * 0.16, cy), (cx + R * 0.16, cy)], outline=INK)
    f = font(40); d.text((cx - 11, cy - R - 48), 'N', font=f, fill=INK)
    icons.convert('RGB').save(out / 'base_icons.png'); print('base_icons.png 存好')
    icons.convert('RGB').resize((W // 2, H // 2), Image.LANCZOS).save(out / 'preview_half.png')

    meta = {'sheet': args.sheet, 'zoom': sh.z, 'tile_x': [sh.tx0, sh.tx1], 'tile_y': [sh.ty0, sh.ty1], 'origin_px': [sh.ox, sh.oy], 'size': [W, H],
            'm_per_px': sh.mpp, 'bounds': [cfg['lon0'], cfg['lat0'], cfg['lon1'], cfg['lat1']]}
    json.dump({'meta': meta, 'items': items, 'labels': label_items}, open(out / 'layout.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('layout.json 存好：', {k: sum(1 for i in items if i['kind'] == k) for k in ('place', 'mountain', 'forest', 'sea')}, '地名', len(label_items))


if __name__ == '__main__':
    main()
