import math, sys, io, os, urllib.request
import numpy as np
from PIL import Image
def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lr = math.radians(lat)
    y = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    return x, y
def fetch(z, x, y):
    fn = f'tiles/{z}_{x}_{y}.png'
    if not os.path.exists(fn):
        os.makedirs('tiles', exist_ok=True)
        d = urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', timeout=30).read()
        open(fn, 'wb').write(d)
    a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
def mosaic(lat, lon, z, nx, ny, name):
    fx, fy = tile_xy(lat, lon, z)
    x0, y0 = int(fx) - nx // 2, int(fy) - ny // 2
    rows = [np.concatenate([fetch(z, x0 + i, y0 + j) for i in range(nx)], axis=1) for j in range(ny)]
    H = np.concatenate(rows, axis=0)
    np.save(f'{name}.npy', H)
    mpp = 156543.03 * math.cos(math.radians(lat)) / 2 ** z
    # hillshade preview
    gy, gx = np.gradient(H, mpp)
    sh = np.clip((-gx * 0.6 + gy * 0.5 + 1.0) / np.sqrt(gx * gx + gy * gy + 1.0), 0, 1.3)
    hn = (H - H.min()) / (H.max() - H.min())
    img = np.stack([sh * (0.55 + 0.45 * hn)] * 3, -1)
    img = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    im = Image.fromarray(img)
    # 1 km grid
    px_km = 1000 / mpp
    from PIL import ImageDraw
    dr = ImageDraw.Draw(im)
    for k in range(0, int(im.width / px_km) + 1):
        dr.line([(k * px_km, 0), (k * px_km, im.height)], fill=(255, 60, 60) if k % 5 == 0 else (120, 40, 40))
    for k in range(0, int(im.height / px_km) + 1):
        dr.line([(0, k * px_km), (im.width, k * px_km)], fill=(255, 60, 60) if k % 5 == 0 else (120, 40, 40))
    im.save(f'{name}.png')
    print(name, H.shape, 'm/px %.1f' % mpp, 'min %.0f max %.0f' % (H.min(), H.max()), 'origin tile', x0, y0)
if __name__ == '__main__':
    lat, lon, z, nx, ny, name = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
    mosaic(lat, lon, z, nx, ny, name)
