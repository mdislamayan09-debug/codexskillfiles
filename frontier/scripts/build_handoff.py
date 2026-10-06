"""Pack the whole project into one self-extracting Markdown file for a fresh session.
usage: python3 scripts/build_handoff.py            (from frontier/; writes ../DUST_AND_REDEMPTION_HANDOFF.md)
The brief is scripts/handoff_header.md; the archive is every git-tracked file under frontier/ (old shots/ left out),
text inline and binaries base64, each with a sha256. The header documents the embedded extractor."""
import base64, hashlib, os, subprocess
REPO = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
OUT = os.path.join(REPO, 'DUST_AND_REDEMPTION_HANDOFF.md')
TEXT = {'.js', '.mjs', '.py', '.md', '.json', '.html', '.css', '.sh', '.txt'}
files = [t for t in subprocess.check_output(['git', 'ls-files', 'frontier'], cwd=REPO, text=True).split('\n') if t and not t.startswith('frontier/shots/')]
parts, index = [], []
for ap in files:
    raw = open(os.path.join(REPO, ap), 'rb').read()
    sha = hashlib.sha256(raw).hexdigest()
    ext = os.path.splitext(ap)[1]
    text = None
    if ext in TEXT or ap.endswith('.gitignore'):
        try:
            text = raw.decode('utf-8')
            if '<<<END FILE>>>' in text: text = None
        except UnicodeDecodeError:
            text = None
    if text is not None: enc, payload = 'utf8', text
    else:
        enc = 'base64'; b = base64.b64encode(raw).decode(); payload = '\n'.join(b[i:i + 120] for i in range(0, len(b), 120))
    parts.append(f'<<<FILE path="{ap}" encoding="{enc}" sha256="{sha}" bytes="{len(raw)}">>>\n{payload}\n<<<END FILE>>>')
    index.append(f'| `{ap}` | {len(raw):,} | {enc} |')
header = open(os.path.join(REPO, 'frontier/scripts/handoff_header.md'), encoding='utf-8').read()
open(OUT, 'w', encoding='utf-8').write(header + '\n| Path | Bytes | Stored as |\n|---|---|---|\n' + '\n'.join(index) + '\n\n==== EMBEDDED FILES ====\n' + '\n'.join(parts) + '\n')
print(len(files), 'files;', os.path.getsize(OUT), 'bytes ->', OUT)
