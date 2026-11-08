"""編幾個人的假紀錄（app 的軌跡點格式），給製圖卡、稱號、行政區探索度看樣子用。全部是假的。

三個人：
  commuter  上班族：住大安區，平日捷運到信義區上班、午餐走一圈、晚上偶爾逛師大；週末永康街、中正紀念堂；有一天坐捷運去淡水
  nightowl  夜貓子：幾乎都在晚上十點後，在西門、萬華、華西街一帶亂走，偶爾走到中正紀念堂
  homebody  宅在家附近的人：住中山區，每天在家附近一公里內散步，常走同幾條路
走路照臺北的棋盤街道走直角（先東西再南北，或反過來），每 10 秒一點加 GPS 抖動；捷運照真的站點連線，每 15 秒一點。

用法：python tools/daycard/make_fake_history.py  →  daycard/fake/<名字>.json（{"points": [[秒, 緯度, 經度, 精度, 模式], ...]}）
"""
import json, math, random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TZ = timezone(timedelta(hours=8))
P = {  # 地點（緯度, 經度）
    'homeA': (25.0283, 121.5452), 'tech': (25.0261, 121.5436), 'daan': (25.0330, 121.5436), 'zxfx': (25.0416, 121.5437),
    'zxdh': (25.0414, 121.5509), 'sysm': (25.0414, 121.5577), 'cityhall': (25.0410, 121.5654), 'office': (25.0368, 121.5672),
    'taipei101': (25.0340, 121.5645), 'eslite': (25.0395, 121.5658), 'forest': (25.0300, 121.5357), 'shida': (25.0245, 121.5287),
    'yongkang': (25.0330, 121.5297), 'ckscmrt': (25.0328, 121.5183), 'cksc': (25.0346, 121.5218), 'mainst': (25.0478, 121.5170),
    'mqxl': (25.0626, 121.5195), 'yuanshan': (25.0713, 121.5201), 'shilin': (25.0935, 121.5262), 'beitou': (25.1320, 121.4986),
    'hongshulin': (25.1541, 121.4589), 'tamsui': (25.1677, 121.4456), 'oldst': (25.1700, 121.4400), 'fisherman': (25.1830, 121.4110),
    'ximen': (25.0421, 121.5081), 'longshan': (25.0372, 121.4999), 'huaxi': (25.0384, 121.4980), 'bopiliao': (25.0365, 121.5016),
    'redhouse': (25.0420, 121.5068), 'nightA': (25.0440, 121.5030), 'zhongshan': (25.0527, 121.5203), 'chifeng': (25.0545, 121.5196),
    'homeC': (25.0600, 121.5240), 'zsps': (25.0626, 121.5265), 'parkC': (25.0585, 121.5275), 'marketC': (25.0618, 121.5208),
}
MRT_WORK = ['tech', 'daan', 'zxfx', 'zxdh', 'sysm', 'cityhall']
MRT_TAMSUI = ['tech', 'daan', (25.0336, 121.5300), 'ckscmrt', 'mainst', 'mqxl', 'yuanshan', 'shilin', 'beitou', 'hongshulin', 'tamsui']


def pt(x): return P[x] if isinstance(x, str) else x


class Day:
    def __init__(self, date, hh, mm):
        self.t = datetime(date.year, date.month, date.day, hh, mm, tzinfo=TZ).timestamp(); self.pts = []; self.pos = None

    def add(self, lat, lng, acc, mode, noise):
        self.pts.append([round(self.t), round(lat + random.gauss(0, noise) / 110540, 6), round(lng + random.gauss(0, noise) / (111320 * math.cos(math.radians(lat))), 6), int(acc + random.random() * 5), mode])

    def line(self, a, b, speed, step_s, mode, noise=4):
        d = math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * math.cos(math.radians(a[0])))
        n = max(1, int(d / (speed * step_s)))
        for k in range(1, n + 1):
            self.t += step_s * random.uniform(0.9, 1.1); f = k / n
            self.add(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, 6 if mode == 'w' else 12, mode, noise)

    def walk(self, *stops):  # 照棋盤街走直角，偶爾多拐一個彎
        for s in stops:
            b = pt(s); a = self.pos
            if a is None: self.pos = b; self.add(b[0], b[1], 8, 'w', 4); continue
            if random.random() < 0.35:  # 中途多拐一個彎，像在巷子裡繞
                m = (a[0] + (b[0] - a[0]) * random.uniform(0.3, 0.7), a[1] + (b[1] - a[1]) * random.uniform(0.3, 0.7))
                legs = [(m[0], a[1]), m, (m[0], b[1]), b] if random.random() < 0.5 else [(a[0], m[1]), m, (b[0], m[1]), b]
            else:
                legs = [(a[0], b[1]), b] if random.random() < 0.5 else [(b[0], a[1]), b]
            for c in legs: self.line(a, c, random.uniform(1.1, 1.45), 10, 'w'); a = c
            self.pos = b

    def ride(self, stations):  # 捷運：站與站之間直線，每 15 秒一點
        a = pt(stations[0]); self.pos = a
        for s in stations[1:]:
            b = pt(s); self.line(a, b, random.uniform(9, 11), 15, 'v', noise=10); self.t += 30; a = b
        self.pos = a

    def stay(self, minutes):
        for _ in range(int(minutes * 60 / 60)):
            self.t += 60; self.add(self.pos[0], self.pos[1], 15, 'w', 10)

    def wait(self, minutes): self.t += minutes * 60  # 不記錄（室內、關掉）


def commuter(start):
    days = []
    for i in range(21):
        d = start + timedelta(days=i); wd = d.weekday()
        if wd < 5:
            m = Day(d, 8, random.randint(10, 35)); m.walk('homeA', 'tech'); m.ride(MRT_WORK); m.walk('office'); days.append(m)
            l = Day(d, 12, 10); l.pos = P['office']; l.walk(random.choice(['taipei101', 'eslite']), 'office'); days.append(l)
            e = Day(d, 18, random.randint(30, 59)); e.pos = P['office']; e.walk('cityhall'); e.ride(MRT_WORK[::-1]); e.walk('homeA')
            if random.random() < 0.3: e.wait(40); e.walk('forest', 'shida'); e.stay(30); e.walk('homeA')
            days.append(e)
        elif i == 13:  # 第二個週六：淡水
            t = Day(d, 10, 0); t.walk('homeA', 'tech'); t.ride(MRT_TAMSUI); t.walk('oldst', 'fisherman'); t.stay(40); t.walk('oldst', 'tamsui')
            t.ride(MRT_TAMSUI[::-1]); t.walk('homeA'); days.append(t)
        else:
            w = Day(d, random.randint(10, 15), 0); w.walk('homeA', 'forest', 'yongkang'); w.stay(50); w.walk(random.choice(['cksc', 'shida']), 'homeA'); days.append(w)
    return days


def nightowl(start):
    days = []
    spots = ['ximen', 'longshan', 'huaxi', 'bopiliao', 'redhouse', 'nightA', 'cksc']
    for i in range(18):
        d = start + timedelta(days=i)
        n = Day(d, random.randint(22, 23), random.randint(0, 50)); n.walk('nightA')
        for s in random.sample(spots, random.randint(3, 5)): n.walk(s); n.stay(random.randint(5, 25))
        n.walk('nightA'); days.append(n)
        if random.random() < 0.3: a = Day(d, 15, 30); a.pos = P['nightA']; a.walk('ximen'); a.stay(20); a.walk('nightA'); days.append(a)
    return days


def homebody(start):
    days = []
    loops = [['parkC', 'zsps', 'homeC'], ['marketC', 'homeC'], ['parkC', 'marketC', 'homeC'], ['chifeng', 'marketC', 'homeC']]
    for i in range(16):
        d = start + timedelta(days=i)
        h = Day(d, random.randint(9, 17), random.randint(0, 59)); h.walk('homeC')
        for s in random.choice(loops): h.walk(s); h.stay(random.randint(0, 15))
        days.append(h)
    return days


def main():
    random.seed(8)
    out = ROOT / 'daycard' / 'fake'; out.mkdir(parents=True, exist_ok=True)
    start = datetime(2026, 10, 19, tzinfo=TZ)
    for name, fn in (('commuter', commuter), ('nightowl', nightowl), ('homebody', homebody)):
        pts = sorted(p for day in fn(start) for p in day.pts)
        json.dump({'v': 1, 'note': '假資料：' + name, 'points': pts}, open(out / f'{name}.json', 'w', encoding='utf-8'))
        print(name, len(pts), '點')


if __name__ == '__main__':
    main()
