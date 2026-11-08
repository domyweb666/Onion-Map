"""把內政部的鄉鎮市區界線轉成 app 用的小檔：assets/admin/tw-admin.json

來源：taiwan-atlas 套件的 towns-10t.json（TopoJSON，內政部「鄉鎮市區界線(TWD97經緯度)」，1:1 萬、已量化簡化）
      npm pack taiwan-atlas@2021.9.20 解開後，把 package/towns-10t.json 的路徑給這支。資料只取用、不進 node_modules。
輸出格式（越小越好，app 製圖時才載）：
  {"src": ..., "counties": [{"n": 名稱, "a": 面積km², "b": [w,s,e,n]}],
   "towns": [{"n": 名稱, "c": 縣市索引, "a": 面積km², "b": [w,s,e,n], "p": [多邊形: [外環, 洞...]，每個環是整數差分 [x0,y0,dx,dy,...]（1e-4 度）]}]}
  面積用原始（簡化前）界線算；形狀再簡化到約 40 公尺。縣市不存形狀：一點落在哪個鄉鎮，就知道在哪個縣市。
用法：python tools/admin/build_admin.py <towns-10t.json>
"""
import json, math, sys
from pathlib import Path
from shapely.geometry import Polygon, MultiPolygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'admin' / 'tw-admin.json'
R = 6378137.0


def decode_arcs(topo):
    sx, sy = topo['transform']['scale']; tx, ty = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0; pts = []
        for dx, dy in arc:
            x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring(arcs, idxs):
    pts = []
    for i in idxs:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def geom(arcs, g):
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    return [[ring(arcs, r) for r in poly] for poly in polys]


def ring_area(pts):  # 球面上的環面積（m²），跟 d3 / turf 同一個公式
    s = 0.0
    for (l1, p1), (l2, p2) in zip(pts, pts[1:] + pts[:1]):
        s += math.radians(l2 - l1) * (2 + math.sin(math.radians(p1)) + math.sin(math.radians(p2)))
    return abs(s) * R * R / 2


def area_km2(polys):
    return sum(ring_area(p[0]) - sum(ring_area(h) for h in p[1:]) for p in polys) / 1e6


def pack(coords):  # 一個環 → 整數差分：[x0, y0, dx1, dy1, ...]，單位 1e-4 度（約 11 公尺）。app 端照順序加回去就好
    out, px, py = [], 0, 0
    for x, y in coords:
        ix, iy = round(x * 1e4), round(y * 1e4)
        if out and ix == px and iy == py: continue
        out += [ix - px, iy - py]; px, py = ix, iy
    return out


def simplify(polys, tol=0.0004):  # 約 40 公尺：只影響界線附近幾格算給誰，探索度的面積用原始界線算
    out = []
    for p in polys:
        sh = Polygon(p[0], p[1:]).simplify(tol, preserve_topology=True)
        for q in (sh.geoms if isinstance(sh, MultiPolygon) else [sh]):
            if q.is_empty or q.area == 0: continue
            out.append([pack(q.exterior.coords)] + [pack(h.coords) for h in q.interiors])
    return out


def bbox(polys):
    xs = [x for p in polys for x, _ in p[0]]; ys = [y for p in polys for _, y in p[0]]
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


TAI = lambda s: s.replace('台', '臺')  # 原始資料用「台」，地圖上的地名與官方用「臺」


def main():
    topo = json.load(open(sys.argv[1], encoding='utf-8'))
    arcs = decode_arcs(topo)
    counties, cidx = [], {}
    for g in topo['objects']['counties']['geometries']:
        polys = geom(arcs, g)
        cidx[g['properties']['COUNTYCODE']] = len(counties)
        counties.append({'n': TAI(g['properties']['COUNTYNAME']), 'a': round(area_km2(polys), 3), 'b': bbox(polys)})
    towns = []
    for g in topo['objects']['towns']['geometries']:
        polys = geom(arcs, g); pr = g['properties']
        towns.append({'n': TAI(pr['TOWNNAME']), 'c': cidx[pr['COUNTYCODE']], 'a': round(area_km2(polys), 3), 'b': bbox(polys), 'p': simplify(polys)})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = {'src': '內政部 鄉鎮市區界線(TWD97經緯度)，經 taiwan-atlas 2021.9.20 量化簡化（政府資料開放授權）', 'counties': counties, 'towns': towns}
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    big = {counties[t['c']]['n'] + t['n']: t['a'] for t in towns if t['n'] in ('大安區', '中正區', '信義區')}
    print(f'{len(counties)} 縣市、{len(towns)} 鄉鎮市區 → {OUT}（{OUT.stat().st_size // 1024} KB）', big,
          {c['n']: c['a'] for c in counties if c['n'] in ('臺北市', '新北市')}, sum(len(r) // 2 for t in towns for p in t['p'] for r in p), '個頂點')


if __name__ == '__main__':
    main()
