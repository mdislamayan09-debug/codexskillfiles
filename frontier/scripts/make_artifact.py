"""Turn the Vite build in dist/ into an artifact page (body-only HTML + supporting files)."""
import json, re, sys
from pathlib import Path
dist = Path('dist'); out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
html = (dist / 'index.html').read_text()
css = re.findall(r'href="\./(assets/[^"]+\.css)"', html)
js = re.findall(r'src="\./(assets/[^"]+\.js)"', html)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script[^>]*></script>', '', body).strip()
page = f'''<title>Dust &amp; Redemption</title>
<style>html, body {{ background: #0c0906; color: #f1e6cc; color-scheme: dark; height: 100%; margin: 0; overflow: hidden; }}</style>
{''.join(f'<link rel="stylesheet" href="{c}">' for c in css)}
{body}
{''.join(f'<script type="module" src="{j}"></script>' for j in js)}
'''
(out / 'index.html').write_text(page)
files = {str(p.relative_to(dist)): str(p.resolve())
         for d in ('assets', 'textures', 'terrain', 'models') if (dist / d).exists() for p in (dist / d).iterdir()}
(out / 'files.json').write_text(json.dumps(files, indent=1))
print(len(files), 'files;', css, js)
