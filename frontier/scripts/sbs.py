"""Side-by-side review sheets and tone numbers: ours (left) against the reference frame (right).
usage: python3 sbs.py <shots_dir> <bar_dir> [shot,shot,...]
Writes <shots_dir>/<shot>_sbs.jpg and prints, for both frames, the mean luminance of each vertical third,
the 5th/95th percentiles, the mean HSV saturation and the mean colour."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

REF = {'pines': 'bar_ref_forest', 'snowride': 'bar_ref_snowride', 'snowvista': 'bar_ref_snowvista',
       'forest': 'bar_forest_hunt', 'town': 'bar_strawberry', 'ranch': 'bar_valentine_heartlands', 'swamp': 'bar_swamp_ride', 'gallop': 'bar_train_ride'}
CROP = {'bar_ref_forest': (0, 0.078, 1, 0.922), 'bar_ref_snowride': (0, 0.078, 1, 0.922), 'bar_ref_snowvista': (0, 0.078, 1, 0.922)}


def stats(im):
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    h = lum.shape[0]
    thirds = [lum[:h // 3].mean(), lum[h // 3:2 * h // 3].mean(), lum[2 * h // 3:].mean()]
    sat = np.asarray(im.convert('HSV'), dtype=np.float32)[..., 1].mean()
    return thirds, np.percentile(lum, 5), np.percentile(lum, 95), sat, a.reshape(-1, 3).mean(0)


def fmt(name, s):
    t, p5, p95, sat, rgb = s
    return f'{name:>5}: thirds {t[0]:5.0f} {t[1]:5.0f} {t[2]:5.0f} | p5 {p5:4.0f} p95 {p95:4.0f} | sat {sat:4.0f} | rgb {rgb[0]:4.0f} {rgb[1]:4.0f} {rgb[2]:4.0f}'


shots, bars = Path(sys.argv[1]), Path(sys.argv[2])
names = sys.argv[3].split(',') if len(sys.argv) > 3 else [p.stem for p in sorted(shots.glob('*.png'))]
W, H = 960, 540
for n in names:
    p = shots / f'{n}.png'
    if not p.exists():
        continue
    o = Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS)
    sheet = Image.new('RGB', (W * 2 + 8, H), (0, 0, 0))
    sheet.paste(o, (0, 0))
    print(n)
    print(' ', fmt('ours', stats(o)))
    bar = REF.get(n)
    if bar and (bars / f'{bar}.jpg').exists():
        b = Image.open(bars / f'{bar}.jpg').convert('RGB')
        w, h = b.size
        c = CROP.get(bar, (0, 0, 1, 1))
        b = b.crop((int(c[0] * w), int(c[1] * h), int(c[2] * w), int(c[3] * h))).resize((W, H), Image.LANCZOS)
        sheet.paste(b, (W + 8, 0))
        print(' ', fmt('ref', stats(b)))
    sheet.save(shots / f'{n}_sbs.jpg', quality=88)
