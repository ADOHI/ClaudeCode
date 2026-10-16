"""Reader for bust-bind/1 exports (web/src/viewer/rig.js exportBind).

Converts bind-space positions into the body frame of field.js scaled by S:
x = left (body side), y = up, z = forward, so one set of numbers works for
MMD units, meters and centimeters alike.
"""

import base64
import json

import numpy as np


def _arr(b64, dtype, cols=None):
    if b64 is None:
        return None
    a = np.frombuffer(base64.b64decode(b64), dtype=dtype)
    return a.reshape(-1, cols) if cols else a


class Frame:
    """Body frame (buildBodyFrame in field.js)."""

    def __init__(self, d):
        self.origin = np.asarray(d['origin'], float)
        self.left = np.asarray(d['left'], float)
        self.up = np.asarray(d['up'], float)
        self.forward = np.asarray(d['forward'], float)
        self.S = float(d['S'])
        self.hipsY = float(d.get('hipsY', -1.0))
        self.neckY = float(d.get('neckY', 1.0))
        # rows = body axes in bind coordinates
        self.R = np.stack([self.left, self.up, self.forward])

    def to_body(self, p):
        """bind-space points (n,3) -> body frame / S."""
        return (np.asarray(p, float) - self.origin) @ self.R.T / self.S

    def from_body(self, b):
        return np.asarray(b, float) * self.S @ self.R + self.origin

    def vec_to_body(self, v):
        """bind-space vectors -> body frame / S (no translation)."""
        return np.asarray(v, float) @ self.R.T / self.S

    def vec_from_body(self, v):
        return np.asarray(v, float) * self.S @ self.R

    def dir_to_body(self, v):
        """unit directions (no scaling)."""
        return np.asarray(v, float) @ self.R.T

    def to_json(self):
        return {
            'origin': self.origin.tolist(), 'left': self.left.tolist(), 'up': self.up.tolist(),
            'forward': self.forward.tolist(), 'S': self.S, 'hipsY': self.hipsY, 'neckY': self.neckY,
        }


class Mesh:
    def __init__(self, i, d):
        self.index_in_file = i
        self.name = d.get('name', f'mesh{i}')
        self.positions = _arr(d['positions'], '<f4', 3).astype(float)
        self.normals = _arr(d.get('normals'), '<f4', 3)
        if self.normals is not None:
            self.normals = self.normals.astype(float)
        idx = _arr(d.get('index'), '<u4')
        n = len(self.positions)
        self.index = (idx if idx is not None else np.arange(n, dtype=np.uint32)).reshape(-1, 3).astype(np.int64)
        m = _arr(d.get('mask'), '<f4')
        self.mask = m.astype(float) if m is not None else np.ones(n)
        self.groups = d.get('groups') or []
        self.bindMatrix = d.get('bindMatrix')

    def triangle_material(self):
        """Material name per triangle ('' when the mesh has no groups)."""
        mat = np.array([''] * len(self.index), dtype=object)
        for g in self.groups:
            mat[g['start'] // 3:(g['start'] + g['count']) // 3] = g['material']
        return mat

    def select_triangles(self, materials=None, masked=True):
        """Triangles whose material is in `materials` (None = all) and whose
        three vertices are inside the skin-weight mask (arms/head excluded)."""
        sel = np.ones(len(self.index), bool)
        if materials is not None:
            if self.groups:
                mat = self.triangle_material()
                sel &= np.isin(mat, list(materials))
            else:
                # Single-material meshes: select by mesh name instead.
                sel &= self.name in materials
        if masked:
            sel &= self.mask[self.index].min(axis=1) >= 0.5
        return self.index[sel]


class BindExport:
    def __init__(self, d):
        if d.get('format') != 'bust-bind/1':
            raise ValueError(f"unsupported format {d.get('format')}")
        self.raw = d
        self.frame = Frame(d['frame'])
        self.params = d['params']
        self.bonePositions = {k: np.asarray(v, float) for k, v in (d.get('bonePositions') or {}).items()}
        self.meshes = [Mesh(i, m) for i, m in enumerate(d['meshes'])]

    @classmethod
    def load(cls, path):
        with open(path) as f:
            return cls(json.load(f))

    def apex_body(self):
        """Apex positions (body frame / S) of both sides from the field params:
        side +1 = body left (+x), side -1 = body right."""
        a = self.params['anchor']
        dep = self.params['depth']
        return {s: np.array([s * a['x'], a['y'], a['z'] + dep]) for s in (1, -1)}
