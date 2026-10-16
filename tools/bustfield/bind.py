"""Reader for bust-bind/1 exports (see tools/README.md, web/src/viewer/rig.js exportBind)."""

import base64
import fnmatch
import json

import numpy as np


def _arr(b64, dtype, shape=None):
    if b64 is None:
        return None
    a = np.frombuffer(base64.b64decode(b64), dtype=dtype)
    return a.reshape(shape) if shape else a


class BindMesh:
    def __init__(self, m):
        self.name = m.get("name")
        n = m["vertexCount"]
        self.positions = _arr(m["positions"], "<f4", (n, 3)).astype(float)
        nrm = _arr(m.get("normals"), "<f4", (n, 3))
        self.normals = None if nrm is None else nrm.astype(float)
        self.index = _arr(m.get("index"), "<u4")
        mask = _arr(m.get("mask"), "<f4")
        self.mask = None if mask is None else mask.astype(float)
        self.bind_matrix = m.get("bindMatrix")
        self.groups = m.get("groups") or []

    @property
    def vertex_count(self):
        return self.positions.shape[0]

    def materials(self):
        return [g["material"] for g in self.groups]

    def group_vertices(self, patterns):
        """Unique vertex ids of the triangles whose material matches any of the
        fnmatch patterns (e.g. ['UP_Skin', 'UP*'])."""
        if isinstance(patterns, str):
            patterns = [patterns]
        idx = self.index if self.index is not None else np.arange(self.vertex_count, dtype=np.uint32)
        sel = []
        for g in self.groups:
            if any(fnmatch.fnmatchcase(g["material"], p) for p in patterns):
                sel.append(idx[g["start"] : g["start"] + g["count"]])
        if not sel:
            return np.zeros(0, dtype=np.int64)
        return np.unique(np.concatenate(sel)).astype(np.int64)

    def group_triangles(self, patterns):
        if isinstance(patterns, str):
            patterns = [patterns]
        idx = self.index if self.index is not None else np.arange(self.vertex_count, dtype=np.uint32)
        sel = [
            idx[g["start"] : g["start"] + g["count"]]
            for g in self.groups
            if any(fnmatch.fnmatchcase(g["material"], p) for p in patterns)
        ]
        if not sel:
            return np.zeros((0, 3), dtype=np.int64)
        return np.concatenate(sel).reshape(-1, 3).astype(np.int64)


class Bind:
    def __init__(self, data):
        if data.get("format") != "bust-bind/1":
            raise ValueError(f"not a bust-bind/1 file: {data.get('format')}")
        self.frame = data["frame"]
        self.params = data["params"]
        self.bone_positions = data.get("bonePositions", {})
        self.meshes = [BindMesh(m) for m in data["meshes"]]

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def select(self, patterns=None):
        """(positions, normals) of the selected vertices over all meshes.

        patterns=None selects every vertex. Meshes without material groups are
        matched by mesh name.
        """
        Ps, Ns = [], []
        for m in self.meshes:
            if patterns is None:
                ids = np.arange(m.vertex_count)
            elif m.groups:
                ids = m.group_vertices(patterns)
            else:
                pats = [patterns] if isinstance(patterns, str) else patterns
                ids = np.arange(m.vertex_count) if any(fnmatch.fnmatchcase(m.name or "", p) for p in pats) else np.zeros(0, int)
            if ids.size == 0:
                continue
            Ps.append(m.positions[ids])
            Ns.append(m.normals[ids] if m.normals is not None else np.zeros((ids.size, 3)))
        if not Ps:
            return np.zeros((0, 3)), np.zeros((0, 3))
        return np.concatenate(Ps), np.concatenate(Ns)

    def centroids(self, patterns=None):
        """Triangle centroids of the selected layers: surface points that are
        not vertices, used as a held-out set when checking a fit."""
        out = []
        for m in self.meshes:
            if patterns is None or not m.groups:
                idx = m.index if m.index is not None else np.arange(m.vertex_count)
                tris = np.asarray(idx, dtype=np.int64).reshape(-1, 3)
                if patterns is not None:
                    pats = [patterns] if isinstance(patterns, str) else patterns
                    if not any(fnmatch.fnmatchcase(m.name or "", p) for p in pats):
                        continue
            else:
                tris = m.group_triangles(patterns)
            if len(tris):
                out.append(m.positions[tris].mean(axis=1))
        return np.concatenate(out) if out else np.zeros((0, 3))
