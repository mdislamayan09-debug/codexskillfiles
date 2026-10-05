"""Build blind A/B pairs (ours vs RDR2 bar) for the gauntlet critic.
usage: python3 make_pairs.py <shots_dir> <bar_dir> <out_dir>
Writes <out_dir>/<piece>_A.jpg, <piece>_B.jpg and a key.json the critic must not read."""
import json, random, sys
from pathlib import Path
from PIL import Image

PAIRS = {
    'ranch': 'bar_valentine_heartlands', 'vista': 'bar_valentine_heartlands',
    'ride': 'bar_swamp_ride', 'swamp': 'bar_swamp_ride', 'gallop': 'bar_train_ride',
    'forest': 'bar_forest_hunt', 'town': 'bar_strawberry', 'camp': 'bar_forest_hunt',
}
CROP = {  # trim postcard borders / torn edges so the frame itself is not a tell
    'bar_valentine_heartlands': (0.05, 0.11, 0.95, 0.93), 'bar_swamp_ride': (0.06, 0.06, 0.94, 0.94),
    'bar_strawberry': (0.05, 0.08, 0.95, 0.93), 'bar_train_ride': (0.05, 0.06, 0.95, 0.94), 'bar_forest_hunt': (0.04, 0.05, 0.96, 0.95),
}
shots, bars, out = map(Path, sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
key = {}
for piece, bar in PAIRS.items():
    s = shots / f'{piece}.png'
    if not s.exists():
        continue
    b = Image.open(bars / f'{bar}.jpg').convert('RGB')
    w, h = b.size
    c = CROP.get(bar, (0, 0, 1, 1))
    b = b.crop((int(c[0] * w), int(c[1] * h), int(c[2] * w), int(c[3] * h)))
    o = Image.open(s).convert('RGB')
    size = (1280, 720)
    b = b.resize(size, Image.LANCZOS); o = o.resize(size, Image.LANCZOS)
    ours_is_a = random.random() < 0.5
    (o if ours_is_a else b).save(out / f'{piece}_A.jpg', quality=90)
    (b if ours_is_a else o).save(out / f'{piece}_B.jpg', quality=90)
    key[piece] = 'A' if ours_is_a else 'B'
(out.parent / f'{out.name}_key.json').write_text(json.dumps(key, indent=2))
print(json.dumps(key))
