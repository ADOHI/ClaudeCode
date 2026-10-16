"""Reader for bust-bind/1 exports (web/src/viewer/rig.js exportBind).

Positions/normals are bind space (model units). The body frame of field.js
(x = left, y = up, z = forward, lengths / S) is used for every number that
should not depend on the model's unit (MMD, meters, centimeters).
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
        return np.asarray(v, float) @ self.R.T / self.S

    def vec_from_body(self, v):
        return np.asarray(v, float) * self.S @ self.R

    def dir_to_body(self, v):
        return np.asarray(v, float) @ self.R.T

    def dir_from_body(self, v):
        return np.asarray(v, float) @ self.R

    def to_json(self):
        return {
            'origin': self.origin.tolist(), 'left': self.left.tolist(), 'up': self.up.tolist(),
            'forward': self.forward.tolist(), 'S': self.S, 'hipsY': self.hipsY, 'neckY': self.neckY,
        }


class Mesh:
    """One exported mesh, everything in bind space."""

    def __init__(self, d, index_in_file):
        self.name = d.get('name', '(mesh)')
        self.index_in_file = index_in_file
        self.positions = _arr(d['positions'], '<f4', 3).astype(float)
        n = len(self.positions)
        nrm = _arr(d.get('normals'), '<f4', 3)
        self.normals = None if nrm is None else nrm.astype(float)
        idx = _arr(d.get('index'), '<u4')
        # null index => sequential triangle list
        self.index = (np.arange(n) if idx is None else idx.astype(np.int64)).reshape(-1, 3)
        mask = _arr(d.get('mask'), '<f4')
        self.mask = None if mask is None else mask.astype(float)
        self.groups = list(d.get('groups') or [])

    @property
    def materials(self):
        return [g['material'] for g in self.groups]

    def select_triangles(self, materials=None):
        """Triangles (k,3) of the given material names (None = all)."""
        if materials is None:
            return self.index
        want = set(materials)
        parts = [self.index[g['start'] // 3:(g['start'] + g['count']) // 3] for g in self.groups if g['material'] in want]
        return np.concatenate(parts) if parts else np.zeros((0, 3), np.int64)

    def material_of_triangles(self):
        """Material name per triangle ('' when the mesh has no groups)."""
        out = np.full(len(self.index), '', dtype=object)
        for g in self.groups:
            out[g['start'] // 3:(g['start'] + g['count']) // 3] = g['material']
        return out


class Bind:
    def __init__(self, d):
        if d.get('format') != 'bust-bind/1':
            raise ValueError(f"not a bust-bind/1 export: {d.get('format')!r}")
        self.frame = Frame(d['frame'])
        self.params = d.get('params')
        self.bone_positions = {k: np.asarray(v, float) for k, v in (d.get('bonePositions') or {}).items()}
        self.meshes = [Mesh(m, i) for i, m in enumerate(d['meshes'])]

    @classmethod
    def load(cls, path):
        with open(path) as f:
            return cls(json.load(f))
