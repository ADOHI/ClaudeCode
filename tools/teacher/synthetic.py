"""A synthetic bust-bind/1 export (curved torso front + two smooth mounds).

Used by the tests and for smoke runs without any model file:

    from tools.teacher.synthetic import synthetic_bind
    bind = BindExport(synthetic_bind())
"""

import base64

import numpy as np


def _b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode('ascii')


def torso_height(x, y, amp=0.18, radius=0.2, apex=(0.27, 0.3)):
    z = 0.45 - 0.8 * x * x - 0.1 * (y - 0.3) ** 2
    for s in (1, -1):
        r = np.hypot(x - s * apex[0], y - apex[1]) / radius
        z = z + amp * np.where(r < 1, (1 - r * r) ** 2, 0.0)
    return z


def synthetic_bind(n=121, scale=1.0, amp=0.18):
    """bust-bind/1 dict in body units * `scale` (S = scale)."""
    xs = np.linspace(-0.65, 0.65, n)
    ys = np.linspace(-0.35, 0.95, n)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    Z = torso_height(X, Y, amp=amp)
    P = np.stack([X, Y, Z], -1).reshape(-1, 3) * scale
    idx = np.arange(n * n).reshape(n, n)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel()
    # Mirror the quad diagonal left of x = 0 so the mesh is exactly symmetric.
    left = (X[:-1, :-1] + X[1:, :-1]).ravel() < 0
    t1 = np.where(left[:, None], np.stack([a, b, c], 1), np.stack([a, b, d], 1))
    t2 = np.where(left[:, None], np.stack([b, d, c], 1), np.stack([a, d, c], 1))
    tris = np.concatenate([t1, t2]).astype(np.uint32)
    N = np.zeros_like(P)
    fn = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
    for k in range(3):
        np.add.at(N, tris[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    apex_z = float(torso_height(np.array(0.27), np.array(0.3), amp=amp))
    params = {
        'anchor': {'x': 0.27, 'y': 0.3, 'z': apex_z - 0.2}, 'depth': 0.2,
        'window': {'x': 0.32, 'yUp': 0.44, 'yDown': 0.42, 'zFront': 1.0, 'zBack': 0.3, 'hardness': 0.15, 'hardnessZ': 0.3},
        'midline': 0.1, 'midlineLock': 0.15, 'kernel': 'kelvinlet', 'targets': {}, 'mask': {},
    }
    return {
        'format': 'bust-bind/1',
        'frame': {'origin': [0.0, 0.0, 0.0], 'left': [1.0, 0.0, 0.0], 'up': [0.0, 1.0, 0.0], 'forward': [0.0, 0.0, 1.0],
                  'S': float(scale), 'hipsY': -1.0 * scale, 'neckY': 1.0 * scale},
        'params': params,
        'bones': {},
        'bonePositions': {},
        'meshes': [{
            'name': 'Body', 'vertexCount': int(len(P)),
            'positions': _b64(P.astype('<f4')), 'normals': _b64(N.astype('<f4')), 'index': _b64(tris.astype('<u4')),
            'mask': _b64(np.ones(len(P), '<f4')), 'bindMatrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            'groups': [{'start': 0, 'count': int(tris.size), 'material': 'Body'}],
        }],
    }
