"""Contact sheet of numbered probe frames. usage: python3 sheet.py <prefix> <count> <out.jpg> [cols=3] [tile width=640]"""
import sys
from PIL import Image, ImageDraw
prefix, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 640
ims = [Image.open(f'{prefix}{i}.png').convert('RGB') for i in range(n)]
th = round(tw * ims[0].height / ims[0].width)
rows = (n + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th))
for i, im in enumerate(ims):
    im = im.resize((tw, th), Image.LANCZOS)
    ImageDraw.Draw(im).text((8, 6), str(i), fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
sheet.save(out, quality=85)
