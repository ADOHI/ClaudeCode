"""Teacher samples: where the distiller sees the teacher displacement.

Three kinds (decision-v2 3(a), 'distillation'):
  skin      mesh vertices of the body skin / tight clothing inside the volume
            footprint (and layers slightly above it), barycentric in the tets
  interior  every node of the proxy volume (chest wall and rim included, U = 0)
  shell     points 'shellOffsets' S outside the skin along the vertex normal,
            carrying the skin value (constant extrapolation): this pins the
            field where outer clothing layers sit
Weights are the lumped area (skin, shell) or volume (interior) of each
sample, normalized so that every kind sums to 1; the distiller chooses the
balance between kinds.
"""

import numpy as np

KINDS = {'skin': 0, 'interior': 1, 'shell': 2}


def _lumped_area(B, tris, n):
    a = 0.5 * np.linalg.norm(np.cross(B[tris[:, 1]] - B[tris[:, 0]], B[tris[:, 2]] - B[tris[:, 0]]), axis=1)
    w = np.zeros(n)
    for k in range(3):
        np.add.at(w, tris[:, k], a / 3)
    return w


def _lumped_volume(X, tets):
    a = X[tets[:, 0]]
    V = np.abs(np.linalg.det(np.stack([X[tets[:, k]] - a for k in (1, 2, 3)], 2))) / 6
    w = np.zeros(len(X))
    for k in range(4):
        np.add.at(w, tets[:, k], V / 4)
    return w


class SampleSet:
    """Sample positions (body / S) with their location in the proxy volume."""

    def __init__(self, bind, vol, cfg):
        fr = bind.frame
        sc = cfg['samples']
        vc = cfg['volume']
        mats = sc.get('sampleMaterials')
        if mats is None and (vc.get('skinMaterials') is not None or vc.get('envelopeMaterials') is not None):
            mats = list(vc.get('skinMaterials') or []) + list(vc.get('envelopeMaterials') or [])
        P, kind, vid, mesh, w, parent = [], [], [], [], [], []
        skinP, skinN, skinW = [], [], []
        for m in bind.meshes:
            tris = m.select_triangles(mats)
            if len(tris) == 0:
                continue
            B = fr.to_body(m.positions)
            area = _lumped_area(B, tris, len(B))
            verts = np.unique(tris)
            tet, _, clamped = vol.locate(B[verts])
            keep = (tet >= 0) & (clamped >= -0.01) & (clamped <= sc['maxAboveSurface'])
            v = verts[keep]
            P.append(B[v])
            kind.append(np.full(len(v), KINDS['skin']))
            vid.append(v)
            mesh.append(np.full(len(v), m.index_in_file))
            w.append(area[v])
            nb = fr.dir_to_body(m.normals[v]) if m.normals is not None else np.tile([0.0, 0.0, 1.0], (len(v), 1))
            skinP.append(B[v])
            skinN.append(nb)
            skinW.append(area[v])
        skin_n = sum(len(p) for p in skinP)
        P = [np.concatenate(P)] if P else [np.zeros((0, 3))]
        kind = [np.concatenate(kind)] if kind else [np.zeros(0, int)]
        vid = [np.concatenate(vid)] if vid else [np.zeros(0, int)]
        mesh = [np.concatenate(mesh)] if mesh else [np.zeros(0, int)]
        w = [np.concatenate(w)] if w else [np.zeros(0)]
        parent = [np.arange(skin_n)]

        # Interior: all volume nodes.
        P.append(vol.X)
        kind.append(np.full(vol.n_nodes, KINDS['interior']))
        vid.append(np.full(vol.n_nodes, -1))
        mesh.append(np.full(vol.n_nodes, -1))
        w.append(_lumped_volume(vol.X, vol.tets))
        parent.append(np.full(vol.n_nodes, -1))

        # Shell: offsets along front-facing normals of skin samples that sit
        # on the outer surface (inner layers would spawn shells inside).
        if skin_n:
            sP, sN, sW = np.concatenate(skinP), np.concatenate(skinN), np.concatenate(skinW)
            zt = vol.surface_heights(sP)[:, 1]
            front = (sN[:, 2] > 0.2) & (sP[:, 2] >= zt - 0.01)
            idx = np.nonzero(front)[0]
            for d in sc['shellOffsets']:
                P.append(sP[idx] + d * sN[idx])
                kind.append(np.full(len(idx), KINDS['shell']))
                vid.append(np.full(len(idx), -1))
                mesh.append(np.full(len(idx), -1))
                w.append(sW[idx] / len(sc['shellOffsets']))
                parent.append(idx)

        self.P_body = np.concatenate(P)
        self.kind = np.concatenate(kind).astype(np.uint8)
        self.vid = np.concatenate(vid).astype(np.int64)
        self.mesh = np.concatenate(mesh).astype(np.int64)
        self.parent = np.concatenate(parent).astype(np.int64)  # shell -> skin sample index
        w = np.concatenate(w)
        for k in KINDS.values():
            s = self.kind == k
            if s.any() and w[s].sum() > 0:
                w[s] /= w[s].sum()
        self.w = w
        self.side = np.where(self.P_body[:, 0] >= 0, 1, -1).astype(np.int8)
        self.frame = fr
        self.vol = vol
        # Interpolation operators.
        n_skin = int((self.kind == KINDS['skin']).sum())
        self.tet, self.bary, _ = vol.locate(self.P_body[:n_skin])

    def __len__(self):
        return len(self.P_body)

    def P_bind(self):
        return self.frame.from_body(self.P_body)

    def field_body(self, U_nodes):
        """Nodal displacement (N, 3, body / S) -> displacement at every sample."""
        n_skin = len(self.tet)
        out = np.zeros((len(self), 3))
        out[:n_skin] = self.vol.interpolate(self.tet, self.bary, U_nodes)
        inter = self.kind == KINDS['interior']
        out[inter] = U_nodes
        shell = self.kind == KINDS['shell']
        out[shell] = out[self.parent[shell]]
        return out

    def to_bind(self, U_body):
        return self.frame.vec_from_body(U_body)
