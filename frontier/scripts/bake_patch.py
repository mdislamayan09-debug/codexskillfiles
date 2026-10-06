# Bake a real-world elevation window into a game-space heightmap patch.
# Source: USGS 3DEP / SRTM via Mapzen-Tilezen Terrain Tiles on AWS Open Data (Terrarium encoding).
#
# usage: python3 bake_patch.py <out_base> --lat L --lon L --gx X --gz Z --hw W --hh H [--rot DEG] [--hs 0.55] [--vs 0.9]
#                              [--ref-elev E] [--base B] [--zoom 14] [--cell 4] [--smooth 1.3]
#   game window: centre (gx, gz), half-extents hw x hh metres, cell size in game metres
#   rot: degrees the real ground is turned clockwise before it is laid on the map (0 = real north at game -z)
#   ref-elev/base: real elevation ref-elev lands at game height base (default: the window minimum lands at base)
# Writes <out_base>.png (R*256+G in 0.1 m steps, offset 100 m) and <out_base>.json (patch meta).
import argparse, json, math, os, urllib.request
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('out')
for k, d in [('lat', None), ('lon', None), ('gx', None), ('gz', None), ('hw', None), ('hh', None), ('rot', 0.0), ('hs', 0.55), ('vs', 0.9),
             ('ref-elev', None), ('base', 0.0), ('zoom', 14), ('cell', 4.0), ('smooth', 1.3)]:
    ap.add_argument('--' + k, type=float, default=d)
ap.add_argument('--name', default='')
ap.add_argument('--tiles', default='tiles')
A = ap.parse_args()
Z = int(A.zoom)

cache = {}
def tile(x, y):
    if (x, y) in cache: return cache[(x, y)]
    fn = f'{A.tiles}/{Z}_{x}_{y}.png'
    if not os.path.exists(fn):
        os.makedirs(A.tiles, exist_ok=True)
        open(fn, 'wb').write(urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=60).read())
    a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float64)
    cache[(x, y)] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return cache[(x, y)]

def tile_f(lat, lon):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    lr = np.radians(lat)
    y = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n
    return x, y

# game grid
gxs = np.arange(A.gx - A.hw, A.gx + A.hw + 0.01, A.cell)
gzs = np.arange(A.gz - A.hh, A.gz + A.hh + 0.01, A.cell)
W, H = len(gxs), len(gzs)
GX, GZ = np.meshgrid(gxs, gzs)
# game offset from centre -> real metres east/north (undo the clockwise turn)
dx, dz = (GX - A.gx) / A.hs, (GZ - A.gz) / A.hs
th = math.radians(A.rot)
# real frame: east = +x, north = -z when rot = 0; rotate the game offset by -rot to find the real offset
c, s = math.cos(th), math.sin(th)
east = dx * c - (-dz) * s
north = dx * s + (-dz) * c
lat = A.lat + north / 111132.0
lon = A.lon + east / (111320.0 * math.cos(math.radians(A.lat)))
TX, TY = tile_f(lat, lon)
tx0, tx1 = int(TX.min()), int(TX.max()); ty0, ty1 = int(TY.min()), int(TY.max())
print('tiles', (tx1 - tx0 + 1) * (ty1 - ty0 + 1), 'grid', W, H)
M = np.concatenate([np.concatenate([tile(x, y) for x in range(tx0, tx1 + 1)], axis=1) for y in range(ty0, ty1 + 1)], axis=0)
PX, PY = (TX - tx0) * 256 - 0.5, (TY - ty0) * 256 - 0.5
i0 = np.clip(np.floor(PX).astype(int), 0, M.shape[1] - 2); j0 = np.clip(np.floor(PY).astype(int), 0, M.shape[0] - 2)
fx, fy = np.clip(PX - i0, 0, 1), np.clip(PY - j0, 0, 1)
E = M[j0, i0] * (1 - fx) * (1 - fy) + M[j0, i0 + 1] * fx * (1 - fy) + M[j0 + 1, i0] * (1 - fx) * fy + M[j0 + 1, i0 + 1] * fx * fy
if A.smooth > 0:
    R = int(math.ceil(A.smooth * 3))
    k = np.exp(-0.5 * (np.arange(-R, R + 1) / A.smooth) ** 2); k /= k.sum()
    E = np.apply_along_axis(lambda r: np.convolve(np.pad(r, R, mode='edge'), k, mode='valid'), 1, E)
    E = np.apply_along_axis(lambda r: np.convolve(np.pad(r, R, mode='edge'), k, mode='valid'), 0, E)
ref = E.min() if A.ref_elev is None else A.ref_elev
G = A.base + (E - ref) * A.vs
OFF = 400.0
enc = np.clip(np.round((G + OFF) * 10), 0, 65535).astype(np.uint32)
img = np.zeros((H, W, 3), np.uint8); img[..., 0] = enc >> 8; img[..., 1] = enc & 255
Image.fromarray(img).save(A.out + '.png', optimize=True)
meta = {'name': A.name, 'x0': float(gxs[0]), 'z0': float(gzs[0]), 'cell': A.cell, 'w': W, 'h': H, 'offset': OFF, 'step': 0.1,
        'hscale': A.hs, 'vscale': A.vs, 'rot': A.rot, 'lat': A.lat, 'lon': A.lon}
json.dump(meta, open(A.out + '.json', 'w'))
gy, gx = np.gradient(G, A.cell)
sh = np.clip((-gx * 0.7 + gy * 0.5 + 1) / np.sqrt(gx * gx + gy * gy + 1), 0, 1.2)
prev = np.clip(sh * (0.5 + 0.5 * (G - G.min()) / max(1e-3, G.max() - G.min())), 0, 1)
prev[G < 0] *= 0.5
Image.fromarray((prev * 255).astype(np.uint8)).save(A.out + '_preview.png')
print('wrote', A.out, W, H, 'game height %.0f..%.0f' % (G.min(), G.max()), os.path.getsize(A.out + '.png') // 1024, 'KB')
