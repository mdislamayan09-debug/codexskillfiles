# Bake a real-world DEM window into a game-space heightmap (RGB PNG, 0.1 m steps) + meta JSON.
import math, os, json, urllib.request, sys
import numpy as np
from PIL import Image
Z = 14
HS, VS = 0.55, 0.95                 # game metres per real metre (horizontal, vertical)
LON_REF, LAT_N = -105.8513, 40.4265  # thalweg longitude; real latitude at game z = -4096
X_REF = -700.0                       # game x of the thalweg reference
GX0, GX1, GZ0, GZ1, CELL = -4096, 4096, -4096, -1150, 4.0
FLOOR_GAME = 150.0                   # game height of the valley floor at the south end of the patch
def tile_f(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    lr = math.radians(lat)
    y = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    return x, y
cache = {}
def tile(x, y):
    if (x, y) in cache: return cache[(x, y)]
    fn = f'tiles/{Z}_{x}_{y}.png'
    if not os.path.exists(fn):
        os.makedirs('tiles', exist_ok=True)
        open(fn, 'wb').write(urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=30).read())
    a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float64)
    cache[(x, y)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return cache[(x, y)]
m_per_deg_lat = 111132.0
m_per_deg_lon = 111320.0 * math.cos(math.radians(LAT_N - 0.025))
gxs = np.arange(GX0, GX1 + 0.01, CELL); gzs = np.arange(GZ0, GZ1 + 0.01, CELL)
W, H = len(gxs), len(gzs)
lon = LON_REF + (gxs - X_REF) / HS / m_per_deg_lon
lat = LAT_N - (gzs - GZ0) / HS / m_per_deg_lat
tx = np.array([tile_f(lat[0], l)[0] for l in lon]); ty = np.array([tile_f(la, lon[0])[1] for la in lat])
# gather the tile block
tx0, tx1 = int(tx.min()), int(tx.max()); ty0, ty1 = int(ty.min()), int(ty.max())
print('tiles', tx0, tx1, ty0, ty1, (tx1 - tx0 + 1) * (ty1 - ty0 + 1))
M = np.concatenate([np.concatenate([tile(x, y) for x in range(tx0, tx1 + 1)], axis=1) for y in range(ty0, ty1 + 1)], axis=0)
px = (tx - tx0) * 256 - 0.5; py = (ty - ty0) * 256 - 0.5
PX, PY = np.meshgrid(px, py)
i0 = np.clip(np.floor(PX).astype(int), 0, M.shape[1] - 2); j0 = np.clip(np.floor(PY).astype(int), 0, M.shape[0] - 2)
fx = PX - i0; fy = PY - j0
E = (M[j0, i0] * (1 - fx) * (1 - fy) + M[j0, i0 + 1] * fx * (1 - fy) + M[j0 + 1, i0] * (1 - fx) * fy + M[j0 + 1, i0 + 1] * fx * fy)
# thalweg: lowest point near the reference line, row by row, then smoothed
valley = []
cx = int((X_REF - GX0) / CELL)
for j in range(0, H, 40):
    lo, hi = max(0, cx - 220), min(W, cx + 220)
    i = lo + int(np.argmin(E[j, lo:hi]))
    valley.append([float(gxs[i]), float(gzs[j]), float(E[j, i])])
xs = np.array([v[0] for v in valley]); k = np.ones(3) / 3
xs_s = np.convolve(np.pad(xs, 1, mode='edge'), k, mode='valid')
floor_south = valley[-1][2]
# light gaussian (sigma ~1.3 cells) removes the contour ribbing of the source tiles
gk = np.exp(-0.5 * (np.arange(-4, 5) / 1.3) ** 2); gk /= gk.sum()
Es = np.apply_along_axis(lambda r: np.convolve(np.pad(r, 4, mode='edge'), gk, mode='valid'), 1, E)
Es = np.apply_along_axis(lambda c: np.convolve(np.pad(c, 4, mode='edge'), gk, mode='valid'), 0, Es)
G = FLOOR_GAME + (Es - floor_south) * VS
valley_game = [[round(float(xs_s[n]), 1), round(v[1], 1), round(FLOOR_GAME + (v[2] - floor_south) * VS, 1)] for n, v in enumerate(valley)]
# cabin: a gentle bench 15-60 m above the floor, 120-320 m off the creek, near game z -2700
gy, gx = np.gradient(G, CELL)
slope = np.hypot(gx, gy)
best, bs = None, -1e9
for v in valley_game:
    if abs(v[1] + 2700) > 260: continue
    j = int((v[1] - GZ0) / CELL)
    for side in (1, -1):
        for d in range(120, 330, 10):
            i = int((v[0] + side * d - GX0) / CELL)
            if not (5 < i < W - 5 and 5 < j < H - 5): continue
            above = G[j, i] - v[2]
            sl = slope[j - 6:j + 7, i - 6:i + 7].max()
            if sl > 0.2 or above < 12 or above > 70: continue
            sc = -abs(above - 35) - sl * 120 - abs(d - 200) * 0.05 + (5 if side > 0 else 0)
            if sc > bs: bs, best = sc, [float(gxs[i]), float(gzs[j])]
print('floor south %.0f m real; game height range %.0f..%.0f; cabin %s' % (floor_south, G.min(), G.max(), best))
OFF = 100.0
enc = np.clip(np.round((G + OFF) * 10), 0, 65535).astype(np.uint32)
img = np.zeros((H, W, 3), np.uint8); img[..., 0] = enc >> 8; img[..., 1] = enc & 255
out = sys.argv[1]
Image.fromarray(img).save(out + '.png', optimize=True)
json.dump({'name': 'Kawuneeche Valley, Rocky Mountain NP (USGS 3DEP via AWS Terrain Tiles)', 'x0': GX0, 'z0': GZ0, 'cell': CELL, 'w': W, 'h': H,
           'offset': OFF, 'step': 0.1, 'hscale': HS, 'vscale': VS, 'valley': valley_game, 'cabin': best}, open(out + '.json', 'w'))
print('wrote', out, W, H, os.path.getsize(out + '.png') // 1024, 'KB')
# preview
sh = np.clip((-gx * 0.7 + gy * 0.5 + 1) / np.sqrt(gx * gx + gy * gy + 1), 0, 1.2)
Image.fromarray((np.clip(sh * (0.5 + 0.5 * (G - G.min()) / (G.max() - G.min())), 0, 1) * 255).astype(np.uint8)).save(out + '_preview.png')
