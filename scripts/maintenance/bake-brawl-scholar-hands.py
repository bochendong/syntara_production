"""Re-bake the scholar's hands and forearms in scholar-shino/mesh.bin from the source VRM.

The game shows the VRoid model as rigid per-joint batches. This script re-poses the
finger bones (right hand: tripod pencil grip, left hand: palm under the book cover),
rotates the wrist, and spreads the forearm twist along the whole forearm instead of
snapping it at the wrist. The pose parameters were solved against the pencil and book
placement in scholar-model.js (pencil tip/axis, book leaf), so re-run this only after
restoring the original hand/elbow batches if those placements change.

Usage: python3 -I scripts/maintenance/bake-brawl-scholar-hands.py ORIGINAL_MESH_BIN
  ORIGINAL_MESH_BIN: scholar-shino/mesh.bin from commit 727eece (before this bake).
Writes apps/native/public/games/sandbox-brawl/scholar-shino/mesh.bin. Needs numpy, scipy.
"""
import json, struct, sys
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot

ROOT = Path(__file__).resolve().parents[2]
VRM = ROOT / 'artifacts/brawl-campus-art/sendagaya-shino-welcome-school-uniform-2019.vrm'
GAME = ROOT / 'apps/native/public/games/sandbox-brawl/scholar-shino'

RIGHT = [0.744037, 1.046946, 0.560466, 0.149652, 0.819559, 1.006119, 0.539414, 0.087216, -0.754295, -0.143684, -0.505718, 0.139999, -0.653681, 0.568959, -0.388192, -0.214994, 0.705619, 0.016646, 0.813611, 0.174778, 0.499946]
LEFT = [-0.081962, 0.283114, 0.26091, 0.3, -0.061688, 0.125588, 0.308577, 0.10022, 0.006794, 0.120263, 0.084015, -0.039822, 0.017655, 0.033491, 0.073698, -0.163796, -0.177133, 0.42528, -0.224701, -0.243801, 0.249269, -0.010552, -0.05664, 0.094193, -0.027958, -0.0463, 0.845727, 0.583097, -2.645639]

raw = VRM.read_bytes()
jlen = struct.unpack('<I', raw[12:16])[0]
gltf = json.loads(raw[20:20 + jlen]); BIN = raw[20 + jlen + 8:]
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def accessor(i):
    a = gltf['accessors'][i]; bv = gltf['bufferViews'][a['bufferView']]
    dt = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0); size = np.dtype(dt).itemsize * n
    if stride and stride != size:
        arr = np.frombuffer(BIN, np.uint8, a['count'] * stride, off).reshape(-1, stride)[:, :size].copy().view(dt).reshape(a['count'], n)
    else:
        arr = np.frombuffer(BIN, dt, a['count'] * n, off).reshape(a['count'], n)
    return arr / (255.0 if dt == np.uint8 else 65535.0) if a.get('normalized') else arr

nodes = gltf['nodes']; names = [n['name'] for n in nodes]; idx = {n: i for i, n in enumerate(names)}
parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
def local(i):
    n = nodes[i]; M = np.eye(4)
    M[:3, :3] = Rot.from_quat(n.get('rotation', [0, 0, 0, 1])).as_matrix() * np.array(n.get('scale', [1, 1, 1]))
    M[:3, 3] = n.get('translation', [0, 0, 0]); return M
order, seen = [], set()
def visit(i):
    if i in seen: return
    if i in parent: visit(parent[i])
    seen.add(i); order.append(i)
for i in range(len(nodes)): visit(i)
LOC = [local(i) for i in range(len(nodes))]
def world_all(extra):
    G = [None] * len(nodes)
    for i in order:
        M = LOC[i] @ extra[i] if i in extra else LOC[i]
        G[i] = G[parent[i]] @ M if i in parent else M
    return G
skin = gltf['skins'][1]; joints = skin['joints']
IBM = accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
body = next(m for m in gltf['meshes'] if m['name'] == 'Body.baked')['primitives'][0]['attributes']
P = accessor(body['POSITION']).astype(float); UV = accessor(body['TEXCOORD_0']).astype(float)
JN = accessor(body['JOINTS_0']).astype(int); WT = accessor(body['WEIGHTS_0']).astype(float)
def jpos(name): return world_all({})[idx[name]][:3, 3]

parts = json.loads((GAME / 'parts.json').read_text())
orig = Path(sys.argv[1]).read_bytes()
tree = cKDTree(UV)
def batch(joint):
    j, mat, off, cnt, ic = next(p for p in parts if p[0] == joint and p[1] == 9)
    v = np.frombuffer(orig, np.float32, cnt * 5, off).reshape(-1, 5).astype(float)
    return dict(off=off, cnt=cnt, v=v, ix=tree.query(v[:, 3:5])[1])
def similarity(A, B):
    ca, cb = A.mean(0), B.mean(0); a, b = A - ca, B - cb
    u, s, vt = np.linalg.svd(a.T @ b); d = np.sign(np.linalg.det(u @ vt)); S = np.diag([1, 1, d])
    R = (u @ S @ vt).T; sc = (s * np.diag(S)).sum() / (a * a).sum()
    M = np.eye(4); M[:3, :3] = sc * R; M[:3, 3] = cb - sc * R @ ca; return M
def forearm_map(side, eb):
    ix = eb['ix']; m = np.array([names[joints[j]] == f'J_Bip_{side}_LowerArm' for j in JN[ix][:, 0]]) & (WT[ix][:, 0] > 0.99)
    return similarity(P[ix[m]], eb['v'][m, :3])

def rv(v): M = np.eye(4); M[:3, :3] = Rot.from_rotvec(v).as_matrix(); return M
def finger(side, flex, spread=0.0):
    s = -1 if side == 'R' else 1
    return rv([0, 0, s * flex]) @ rv([0, spread, 0])
def pose(side, x):
    e = {}
    if side == 'R':
        for f, a in (('Ring', (1.15, 1.35, 0.8, -0.05)), ('Little', (1.25, 1.3, 0.75, -0.1))):
            e[f'J_Bip_R_{f}1'] = finger('R', a[0], a[3]); e[f'J_Bip_R_{f}2'] = finger('R', a[1]); e[f'J_Bip_R_{f}3'] = finger('R', a[2])
        fingers = ('Index', 'Middle'); t0 = 8
    else:
        fingers = ('Index', 'Middle', 'Ring', 'Little'); t0 = 16
    for k, f in enumerate(fingers):
        a = x[4 * k:4 * k + 4]
        e[f'J_Bip_{side}_{f}1'] = finger(side, a[0], a[3]); e[f'J_Bip_{side}_{f}2'] = finger(side, a[1]); e[f'J_Bip_{side}_{f}3'] = finger(side, a[2])
    for k in range(3): e[f'J_Bip_{side}_Thumb{k + 1}'] = rv(x[t0 + 3 * k:t0 + 3 * k + 3])
    e[f'J_Bip_{side}_Hand'] = rv(x[t0 + 9:t0 + 12])
    return {idx[k]: v for k, v in e.items()}, x[t0 + 12]

ARM = {k for k in range(len(joints)) if any(t in names[joints[k]] for t in ('LowerArm', 'UpperArm', 'Shoulder'))}
def bake(side, x, ix, EM):
    extra, twist = pose(side, x)
    e0, w0 = jpos(f'J_Bip_{side}_LowerArm'), jpos(f'J_Bip_{side}_Hand')
    ax = (w0 - e0) / np.linalg.norm(w0 - e0); length = np.linalg.norm(w0 - e0)
    G = world_all(extra); JM = np.array([G[joints[k]] @ IBM[k] for k in range(len(joints))])
    p = np.c_[P[ix], np.ones(len(ix))]
    s = np.clip(((P[ix] - e0) @ ax) / length, 0, 1); s = s * s * (3 - 2 * s)
    Tw = np.eye(4); Tw[:3, :3] = Rot.from_rotvec(ax * twist).as_matrix(); Tw[:3, 3] = w0 - Tw[:3, :3] @ w0
    Ra = Rot.from_rotvec(ax[None] * (twist * s)[:, None]).as_matrix()
    out = np.zeros((len(ix), 3))
    for k in range(4):
        jk = JN[ix][:, k]; wk = WT[ix][:, k]; isarm = np.array([j in ARM for j in jk])
        hand = np.einsum('nij,nj->ni', np.einsum('ij,njk->nik', Tw, JM[jk]), p)[:, :3]
        arm = np.einsum('nij,nj->ni', Ra, np.einsum('nij,nj->ni', JM[jk], p)[:, :3] - w0) + w0
        out += wk[:, None] * np.where(isarm[:, None], arm, hand)
    return (EM @ np.c_[out, np.ones(len(out))].T).T[:, :3], twist, ax, w0, e0, length

data = bytearray(orig)
def put(b, xyz):
    arr = b['v'].copy(); arr[:, :3] = xyz
    data[b['off']:b['off'] + b['cnt'] * 20] = arr.astype(np.float32).tobytes()
for side, x in (('R', RIGHT), ('L', LEFT)):
    hand, elbow = batch('hand' + side), batch('elbow' + side)
    EM = forearm_map(side, elbow)
    xyz, twist, ax, w0, e0, length = bake(side, x, hand['ix'], EM)
    put(hand, xyz)
    ix = elbow['ix']; v = elbow['v'][:, :3]
    upper = np.array([sum(WT[q][k] for k in range(4) if any(t in names[joints[JN[q][k]]] for t in ('UpperArm', 'Shoulder'))) for q in ix])
    handw = np.array([sum(WT[q][k] for k in range(4) if JN[q][k] not in ARM) for q in ix])
    s = np.clip(((P[ix] - e0) @ ax) / length, 0, 1); s = s * s * (3 - 2 * s)
    axg = EM[:3, :3] @ ax; axg /= np.linalg.norm(axg); wg = EM[:3, :3] @ w0 + EM[:3, 3]
    ang = twist * s * (1 - upper)
    nv = np.einsum('nij,nj->ni', Rot.from_rotvec(axg[None] * ang[:, None]).as_matrix(), v - wg) + wg
    redo = (handw > 1e-4) & (upper < 1e-4)
    nv[redo] = bake(side, x, ix[redo], EM)[0]
    put(elbow, nv)
(GAME / 'mesh.bin').write_bytes(bytes(data))
