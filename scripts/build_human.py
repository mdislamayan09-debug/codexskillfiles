# Build the game's human body from MakeHuman's CC0 base mesh, morph targets and default rig.
#   python3 build_human.py <makehuman data dir> <out.bin>
# Output (little-endian): uint32 header length, JSON header, pad to 4, then the arrays the header lists:
#   position f32 x3, normal f32 x3, skinIndex u8 x4, skinWeight u8 x4 (sums to 255), region u8, index u32
# The body is morphed to a rugged adult man, the arms are lowered from MakeHuman's A-pose to hang at the sides
# (so the game's animations, written for arms-down rest, work unchanged), MakeHuman's 163 bones are folded onto
# the game's 16-bone rig, and every vertex gets a body-region code the game turns into clothing per outfit.
import json, math, struct, sys
import numpy as np

D, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- mesh
V, faces, group = [], [], None
for line in open(f'{D}/3dobjs/base.obj'):
    if line.startswith('v '):
        V.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('g '):
        group = line.split()[1]
    elif line.startswith('f ') and group == 'body':
        faces.append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
V = np.array(V)

def target(path, w):
    global V
    for line in open(path):
        if not line.strip() or line[0] == '#': continue
        p = line.split()
        V[int(p[0])] += w * np.array([float(p[1]), float(p[2]), float(p[3])])

T = f'{D}/targets/macrodetails'
# a weathered, fit man in his thirties: caucasian male, muscular, average weight, a little above average height
target(f'{T}/caucasian-male-young.target', 1.0)
target(f'{T}/universal-male-young-averagemuscle-averageweight.target', 0.35)
target(f'{T}/universal-male-young-maxmuscle-averageweight.target', 0.65)
target(f'{T}/height/male-young-maxmuscle-averageweight-maxheight.target', 0.25)

skel = json.load(open(f'{D}/rigs/default.mhskel'))
J = {k: V[v].mean(axis=0) for k, v in skel['joints'].items()}
def jpos(bone, end='head'): return J[skel['bones'][bone][end]].copy()

# ---------------------------------------------------------------- MakeHuman weights -> game bones
GAME = ['hips', 'spine', 'neck', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hpL', 'knL', 'anL', 'hpR', 'knR', 'anR']
def game_bone(name):
    side = None
    if name.endswith('.L') or name.endswith('.R'):
        side = 'L' if jpos(name)[0] < 0 else 'R'      # the game's L is -x
    base = name.split('.')[0]
    if base in ('root', 'spine05', 'pelvis'): return 'hips'
    if base in ('spine04', 'spine03', 'spine02', 'spine01', 'breast', 'clavicle', 'shoulder01'): return 'spine'
    if base.startswith('neck'): return 'neck'
    if base.startswith('upperarm'): return 'sh' + side
    if base.startswith('lowerarm'): return 'el' + side
    if base in ('wrist',) or base.startswith('metacarpal') or base.startswith('finger') or base.startswith('thumb'): return 'wr' + side
    if base.startswith('upperleg'): return 'hp' + side
    if base.startswith('lowerleg'): return 'kn' + side
    if base in ('foot',) or base.startswith('toe'): return 'an' + side
    return 'head'                                       # head and every face bone
W = json.load(open(f'{D}/rigs/default_weights.mhw'))['weights']
nV = len(V)
acc = np.zeros((nV, len(GAME)))
for bone, lst in W.items():
    gb = GAME.index(game_bone(bone))
    for vi, w in lst:
        acc[vi, gb] += w

# ---------------------------------------------------------------- relaxed hands: fingers curled toward the palm
def rotmat(axis, ang):
    axis = axis / np.linalg.norm(axis); x, y, z = axis; c, s_ = math.cos(ang), math.sin(ang); C = 1 - c
    return np.array([[c + x*x*C, x*y*C - z*s_, x*z*C + y*s_], [y*x*C + z*s_, c + y*y*C, y*z*C - x*s_], [z*x*C - y*s_, z*y*C + x*s_, c + z*z*C]])
def bw(name):
    w = np.zeros(nV)
    for vi, x in W.get(name, []): w[vi] += x
    return w
for side in ('.L', '.R'):
    fb = lambda f, k: f'finger{f}-{k}{side}'
    if fb(2, 1) not in skel['bones']: break
    palm = np.mean([jpos(fb(f, 1)) for f in (2, 3, 4, 5)], axis=0)
    thumb = jpos(fb(1, 3), 'tail')
    for f in (2, 3, 4, 5):
        for k, ang in ((1, 0.55), (2, 0.75), (3, 0.5)):
            if fb(f, k) not in skel['bones']: continue
            head, tail = jpos(fb(f, k)), jpos(fb(f, k), 'tail')
            d = (tail - head) / np.linalg.norm(tail - head)
            across = jpos(fb(5, 1)) - jpos(fb(2, 1))
            n = np.cross(across, d); n /= np.linalg.norm(n)
            if np.dot(n, thumb - palm) < 0: n = -n            # curl toward the palm, where the thumb sits
            Rm = rotmat(np.cross(d, n), ang)
            w = sum(bw(fb(f, kk)) for kk in range(k, 4))[:, None]
            V = V * (1 - w) + ((V - head) @ Rm.T + head) * w
            for kk in range(k, 4):
                for end in ('head', 'tail'):
                    key = skel['bones'][fb(f, kk)][end]
                    if kk == k and end == 'head': continue
                    J[key] = (J[key] - head) @ Rm.T + head
    # thumb tucks in a little
    if fb(1, 2) in skel['bones']:
        head = jpos(fb(1, 2)); d = jpos(fb(1, 2), 'tail') - head
        Rm = rotmat(np.cross(d, palm - head), 0.35)
        w = (bw(fb(1, 2)) + bw(fb(1, 3)))[:, None]
        V = V * (1 - w) + ((V - head) @ Rm.T + head) * w

# ---------------------------------------------------------------- repose: arms hanging at the sides, legs straight
def rot_to(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-8: return np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))
gidx = {g: i for i, g in enumerate(GAME)}
def chainW(names): return np.clip(sum(acc[:, gidx[n]] for n in names), 0, 1)[:, None]
def side_bone(base, side): return next(n for n in skel['bones'] if n.startswith(base) and (jpos(n)[0] < 0) == (side == 'L'))
def turn(pivot, R, w, joint_bases, side):
    global V
    V = V * (1 - w) + ((V - pivot) @ R.T + pivot) * w
    for k in J:
        b = k.split('____')[0]
        if any(b.startswith(t) for t in joint_bases) and ((J[k][0] < 0) == (side == 'L')):
            J[k] = (J[k] - pivot) @ R.T + pivot
ARM = ('lowerarm', 'wrist', 'finger', 'metacarpal', 'thumb')
LEG = ('lowerleg', 'foot', 'toe')
for side in ('L', 'R'):
    sgn = -1 if side == 'L' else 1
    # upper arm: shoulder -> elbow straight down, a touch out
    sh, el = jpos(side_bone('upperarm01', side)), jpos(side_bone('lowerarm01', side))
    turn(sh, rot_to(el - sh, np.array([sgn * 0.12, -1.0, 0.0])), chainW(['sh' + side, 'el' + side, 'wr' + side]), ARM, side)
    # forearm: elbow -> wrist down, hands just forward of the thighs
    el, wr = jpos(side_bone('lowerarm01', side)), jpos(side_bone('wrist', side))
    turn(el, rot_to(wr - el, np.array([sgn * 0.02, -1.0, 0.1])), chainW(['el' + side, 'wr' + side]), ('wrist', 'finger', 'metacarpal', 'thumb'), side)
    # leg: hip -> ankle straight down
    hp, an = jpos(side_bone('upperleg01', side)), jpos(side_bone('foot', side))
    turn(hp, rot_to(an - hp, np.array([sgn * 0.03, -1.0, 0.0])), chainW(['hp' + side, 'kn' + side, 'an' + side]), LEG, side)

# ---------------------------------------------------------------- keep the body, scale to game units
used = sorted({i for f in faces for i in f})
remap = -np.ones(nV, int); remap[used] = np.arange(len(used))
P = V[used].copy(); acc = acc[used]
minY = P[:, 1].min()
eyeY = (jpos('eye.L')[1] + jpos('eye.R')[1]) / 2
S = 1.763 / (eyeY - minY)                              # eyes at the game rig's 1.763 m (stature ~1.88 m)
pel = jpos('root')
def tf(p): return np.array([(p[0] - pel[0]) * S, (p[1] - minY) * S, (p[2] - pel[2]) * S])
P = np.array([tf(p) for p in P])
for k in J: J[k] = tf(J[k])
def gj(bone, end='head'): return J[skel['bones'][bone][end]]
sideB = lambda base, side: next(n for n in skel['bones'] if n.startswith(base) and (gj(n)[0] < 0) == (side == 'L'))
rest = {
    'hips': gj('root'), 'spine': gj('spine04'), 'neck': gj('neck01'), 'head': gj('head'),
}
for s in ('L', 'R'):
    rest['sh' + s] = gj(sideB('upperarm01', s)); rest['el' + s] = gj(sideB('lowerarm01', s)); rest['wr' + s] = gj(sideB('wrist', s))
    rest['hp' + s] = gj(sideB('upperleg01', s)); rest['kn' + s] = gj(sideB('lowerleg01', s)); rest['an' + s] = gj(sideB('foot', s))
eyes = [gj('eye.L').tolist(), gj('eye.R').tolist()]

# ---------------------------------------------------------------- triangles, normals
tris = []
for f in faces:
    g = [remap[i] for i in f]
    for k in range(1, len(g) - 1): tris.append((g[0], g[k], g[k + 1]))
tris = np.array(tris, np.uint32)
N = np.zeros_like(P)
fn = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
for k in range(3): np.add.at(N, tris[:, k], fn)
N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12

# ---------------------------------------------------------------- skin weights (top 4)
order = np.argsort(-acc, axis=1)[:, :4]
ws = np.take_along_axis(acc, order, axis=1)
ws = ws / (ws.sum(axis=1, keepdims=True) + 1e-9)
wq = np.round(ws * 255).astype(int)
wq[:, 0] += 255 - wq.sum(axis=1)

# ---------------------------------------------------------------- body regions (clothing is decided per outfit in the game)
REG = dict(face=0, scalp=1, neck=2, torso=3, belt=4, pelvis=5, uarm=6, farm=7, hand=8, thigh=9, shin=10, foot=11, beard=12)
dom = np.array([GAME[i] for i in order[:, 0]])
reg = np.zeros(len(P), np.uint8)
beltY = rest['hips'][1] + 0.03
eyeZ = (eyes[0][2] + eyes[1][2]) / 2
for i, (p, d) in enumerate(zip(P, dom)):
    x, y, z = p
    if d in ('head',):
        if y > eyes[0][1] + 0.035 or (z < eyeZ - 0.07 and y > eyes[0][1] - 0.09): r = 'scalp'
        elif y < eyes[0][1] - 0.04 and z > eyeZ - 0.07 and abs(x) < 0.07: r = 'beard'
        else: r = 'face'
    elif d == 'neck': r = 'neck'
    elif d in ('spine', 'hips'): r = 'belt' if abs(y - beltY) < 0.028 else ('torso' if y > beltY else 'pelvis')
    elif d.startswith('sh'): r = 'uarm'
    elif d.startswith('el'): r = 'farm'
    elif d.startswith('wr'): r = 'hand'
    elif d.startswith('hp'): r = 'thigh'
    elif d.startswith('kn'): r = 'shin'
    else: r = 'foot'
    reg[i] = REG[r]

# ---------------------------------------------------------------- write
arrays = [('position', P.astype('<f4')), ('normal', N.astype('<f4')), ('skinIndex', order.astype(np.uint8)),
          ('skinWeight', wq.astype(np.uint8)), ('region', reg), ('index', tris.reshape(-1).astype('<u4'))]
hdr = {'count': len(P), 'regions': REG, 'bones': GAME, 'rest': {k: [round(float(c), 4) for c in v] for k, v in rest.items()},
       'eyes': [[round(c, 4) for c in e] for e in eyes], 'arrays': [], 'source': 'MakeHuman base mesh, targets and default rig (CC0)'}
off = 0
for name, a in arrays:
    hdr['arrays'].append({'name': name, 'offset': off, 'bytes': a.nbytes}); off += a.nbytes; off += (-off) % 4
hj = json.dumps(hdr).encode()
hj += b' ' * ((-len(hj)) % 4)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<I', len(hj))); f.write(hj)
    for name, a in arrays:
        b = a.tobytes(); f.write(b); f.write(b'\0' * ((-len(b)) % 4))
print('vertices', len(P), 'triangles', len(tris), 'height %.3f' % P[:, 1].max(), 'bytes', 4 + len(hj) + off)
print('rest', json.dumps(hdr['rest']))
print('eyes', hdr['eyes'], 'regions', np.bincount(reg).tolist())

# ---------------------------------------------------------------- also packed as a lossless PNG (3 bytes per pixel)
# web hosts that only serve media types (the published artifact) take this copy; the game reads either
from PIL import Image
raw = open(OUT, 'rb').read()  # the .bin is a build intermediate; the game ships the .png
Wp = 1024
Hp = (len(raw) + 4 + Wp * 3 - 1) // (Wp * 3)
buf = struct.pack('<I', len(raw)) + raw
buf += b'\0' * (Wp * Hp * 3 - len(buf))
Image.frombytes('RGB', (Wp, Hp), buf).save(OUT.rsplit('.', 1)[0] + '.png', optimize=True)
print('png', Wp, Hp)
