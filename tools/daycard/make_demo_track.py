"""造一天的模擬軌跡（app 存檔格式），給 daycard.py 試卡用。

路線用 OSRM 步行路徑（tools/sheet/cache/osrm_demo.json，中正紀念堂→永康街→大安森林公園→台大→公館），
走路 4.5 km/h 上下浮動，沿途在幾個點停留，每 10 秒一個點，座標加 GPS 抖動。
用法：python tools/daycard/make_demo_track.py  →  daycard/demo-track.json
"""
import json, math, random
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
random.seed(3)
TZ = timezone(timedelta(hours=8))
START = datetime(2026, 11, 7, 9, 30, tzinfo=TZ)
# (在路線第幾個 leg 的終點停留, 分鐘)：leg 0 起點=中正紀念堂，1=永康街，2=大安森林公園，3=台大，4=公館
DWELL = {0: 28, 1: 55, 2: 42, 3: 24, 4: 0}


def haversine(a, b):
    R = 6371000; la1, la2 = math.radians(a[1]), math.radians(b[1]); d1 = la2 - la1; d2 = math.radians(b[0] - a[0])
    h = math.sin(d1 / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(d2 / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def jitter(lon, lat, m):
    dx, dy = random.gauss(0, m), random.gauss(0, m)
    return lon + dx / (111320 * math.cos(math.radians(lat))), lat + dy / 110540


def main():
    d = json.load(open(ROOT / 'tools' / 'sheet' / 'cache' / 'osrm_demo.json'))
    route = d['routes'][0]; legs = route['legs']; coords = route['geometry']['coordinates']
    # 每個 leg 在 geometry 裡的結尾索引：OSRM 的 legs 沒直接給，用距離累計對應
    leg_end_dist = []; acc = 0
    for lg in legs: acc += lg['distance']; leg_end_dist.append(acc)
    pts = []; t = START.timestamp()
    def add(lon, lat, acc_m=6, noise=5):
        nonlocal t
        lo, la = jitter(lon, lat, noise); pts.append([round(t), round(la, 6), round(lo, 6), int(acc_m + random.random() * 6), 'w'])
    def dwell(lon, lat, minutes):
        nonlocal t
        for _ in range(int(minutes * 60 / 45)): t += 45; add(lon, lat, 10, 12)
    dwell(coords[0][0], coords[0][1], DWELL[0])
    dist = 0; leg_i = 0; speed = 1.25
    for a, b in zip(coords, coords[1:]):
        seg = haversine(a, b); n = max(1, int(seg / (speed * 10)))
        for k in range(1, n + 1):
            f = k / n; lon, lat = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
            speed = min(1.6, max(0.9, speed + random.gauss(0, 0.05))); t += seg / n / speed
            add(lon, lat)
        dist += seg
        if leg_i < len(leg_end_dist) and dist >= leg_end_dist[leg_i] - 1e-6:
            leg_i += 1; dwell(b[0], b[1], DWELL.get(leg_i, 0))
    out = ROOT / 'daycard'; out.mkdir(exist_ok=True)
    state = {'v': 1, 'points': pts, 'cells': {}, 'flights': [], 'gaps': [], 'note': '模擬：中正紀念堂→永康街→大安森林公園→台大→公館'}
    json.dump(state, open(out / 'demo-track.json', 'w', encoding='utf-8'), ensure_ascii=False)
    end = datetime.fromtimestamp(pts[-1][0], TZ)
    print(f'{len(pts)} 點，{route["distance"] / 1000:.1f} km，{START:%H:%M}–{end:%H:%M}，存到 daycard/demo-track.json')


if __name__ == '__main__':
    main()
