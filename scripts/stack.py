"""Stack the side-by-side sheets of several shots into one review image. usage: python3 stack.py <dir> <out.jpg> shot,shot [width]"""
import sys
from PIL import Image
d, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
w = int(sys.argv[4]) if len(sys.argv) > 4 else 1600
ims = [Image.open(f'{d}/{n}_sbs.jpg') for n in names]
ims = [im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im in ims]
sheet = Image.new('RGB', (w, sum(im.height for im in ims) + 6 * (len(ims) - 1)))
y = 0
for im in ims:
    sheet.paste(im, (0, y)); y += im.height + 6
sheet.save(out, quality=86)
