"""把多米生的材質做成真正無縫，存到 assets/textures/（webp，品質 95）。

用法：python tools/sheet/prepare_textures.py --src "C:/Users/fcharlie/Downloads/洋蔥地圖B素材"
檔名靠關鍵字對應：森林→forest、海→water、屋頂／小鎮→urban、草→meadow、紙→paper。

做法：滾半格，原本的四邊跑到中間變成十字接縫；再從原圖同位置切一條帶子補過去，
帶子的邊界用「最小誤差切割」（像拼布那樣沿著兩張最像的地方剪），房子和樹冠不會出現鬼影。
產出 assets/textures/_seam_check.png：每張接四格看縫。
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'textures'
KEYS = [('森林', 'forest'), ('樹冠', 'forest'), ('海', 'water'), ('水', 'water'), ('屋頂', 'urban'), ('小鎮', 'urban'), ('草', 'meadow'), ('紙', 'paper')]


def min_cut(cost):
    """cost: H x B。回傳每一列一個欄索引：由上到下累積誤差最小的路徑，相鄰列最多偏一格"""
    H, B = cost.shape
    acc = cost.astype(np.float64).copy(); back = np.zeros((H, B), np.int8)
    idx = np.arange(B)
    for i in range(1, H):
        prev = acc[i - 1]
        left = np.concatenate([[np.inf], prev[:-1]]); right = np.concatenate([prev[1:], [np.inf]])
        stack = np.stack([left, prev, right]); k = np.argmin(stack, axis=0)
        acc[i] = cost[i] + stack[k, idx]; back[i] = k - 1
    j = int(np.argmin(acc[-1])); path = np.empty(H, np.int64)
    for i in range(H - 1, 0, -1):
        path[i] = j; j = j + int(back[i, j])
    path[0] = j
    return path


def patch_vertical(R, A, c, B, lam=0.08):
    """R 在第 c 欄有接縫；用 A 同位置 [c-B, c+B) 的帶子補，左右兩道邊界各走一條最小誤差路徑。
    lam：離縫越遠越貴，補丁盡量窄，被複製的內容才少（補丁裡的內容在圖的另一頭還會再出現一次）"""
    H = R.shape[0]
    diff = np.sqrt(((R - A) ** 2).sum(axis=2))
    far = lam * np.arange(B, 0, -1)[None, :]  # 左半帶：越靠左離縫越遠
    p1 = min_cut(diff[:, c - B:c] + far); p2 = min_cut(diff[:, c:c + B] + far[:, ::-1])
    M = np.zeros(R.shape[:2], np.float32)
    rows = np.arange(H)
    x0 = c - B + p1; x1 = c + p2
    cols = np.arange(R.shape[1])[None, :]
    M[(cols >= x0[:, None]) & (cols < x1[:, None])] = 1
    M = ndi.gaussian_filter(M, 0.8)[..., None]
    return R * (1 - M) + A * M


def make_seamless(a, band_frac=0.16):
    """兩道各自獨立：先滾半格補左右（補丁取自原圖中央），再把左右已接好的那張滾半格補上下（補丁取自它自己的中央）。
    第二道的補丁橫跨整個寬度，所以來源必須已經左右無縫，不能再用原圖"""
    h, w = a.shape[:2]
    O1 = patch_vertical(np.roll(a, w // 2, axis=1), a, w // 2, int(w * band_frac))
    R2 = np.roll(O1, h // 2, axis=0)
    O2 = patch_vertical(R2.transpose(1, 0, 2), O1.transpose(1, 0, 2), h // 2, int(h * band_frac)).transpose(1, 0, 2)
    return np.clip(O2, 0, 255)


def seam_score(a):
    """四邊接起來的差異 vs 圖內相鄰像素的差異；接近 1 就是真的無縫"""
    inner = np.abs(a[:, 1:] - a[:, :-1]).mean()
    return (np.abs(a[:, 0] - a[:, -1]).mean() + np.abs(a[0] - a[-1]).mean()) / 2 / max(inner, 1e-6)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--src', required=True)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    done = {}
    for p in sorted(Path(args.src).glob('*')):
        if p.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'): continue
        name = next((n for k, n in KEYS if k in p.stem), None)
        if not name: print('  跳過（檔名對不到材質）', p.name); continue
        a = np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
        before = seam_score(a)
        o = make_seamless(a); after = seam_score(o)
        Image.fromarray(o.astype(np.uint8)).save(OUT / f'{name}.webp', quality=95, method=6)
        done[name] = o
        print(f'  {p.name} → {name}.webp  {a.shape[1]}x{a.shape[0]}  接縫差異/內部差異：{before:.2f} → {after:.2f}')
    # 對照表：每張接四格
    cell = 420; sheet = Image.new('RGB', (cell * len(done), cell), (40, 40, 40))
    for i, (name, o) in enumerate(done.items()):
        im = Image.fromarray(o.astype(np.uint8)); n = im.width
        tiled = Image.new('RGB', (n * 2, n * 2)); [tiled.paste(im, (x * n, y * n)) for x in range(2) for y in range(2)]
        sheet.paste(tiled.resize((cell - 8, cell - 8), Image.LANCZOS), (i * cell, 0))
    sheet.save(OUT / '_seam_check.png'); print('存到', OUT, '；_seam_check.png 每張接四格')


if __name__ == '__main__':
    main()
