"""Front height maps in the body frame (the autofit.js idea, vectorized).

A height map stores, at each node of a regular x/y grid, the largest forward
coordinate z of the selected triangles above it. Game meshes are open, layered
and full of holes; a height map sidesteps tetrahedralizing them (TetGen on a
dirty mesh) because the proxy volume is then a simple extrusion.
"""

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla


class Grid:
    """Regular node grid: node (i, j) sits at (x0 + i h, y0 + j h)."""

    def __init__(self, x0, y0, h, nx, ny):
        self.x0, self.y0, self.h, self.nx, self.ny = float(x0), float(y0), float(h), int(nx), int(ny)

    @classmethod
    def covering(cls, xmin, xmax, ymin, ymax, h):
        # Anchor the lattice at x = 0 so left/right sides share node columns
        # (a symmetric mesh then gives a symmetric volume).
        i0 = int(np.floor(xmin / h))
        i1 = int(np.ceil(xmax / h))
        j0 = int(np.floor(ymin / h))
        j1 = int(np.ceil(ymax / h))
        return cls(i0 * h, j0 * h, h, i1 - i0 + 1, j1 - j0 + 1)

    @property
    def xs(self):
        return self.x0 + self.h * np.arange(self.nx)

    @property
    def ys(self):
        return self.y0 + self.h * np.arange(self.ny)

    def node_xy(self):
        X, Y = np.meshgrid(self.xs, self.ys, indexing='ij')
        return X, Y  # shape (nx, ny)


def rasterize_max(grid, B, tris):
    """Max z of triangles `tris` (index rows into body-frame points B) at grid
    nodes. Returns (nx, ny) array with -inf where nothing covers a node."""
    H = np.full(grid.nx * grid.ny, -np.inf)
    if len(tris) == 0:
        return H.reshape(grid.nx, grid.ny)
    a, b, c = B[tris[:, 0]], B[tris[:, 1]], B[tris[:, 2]]
    det = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 1] - c[:, 1])
    ok = np.abs(det) > 1e-14
    a, b, c, det = a[ok], b[ok], c[ok], det[ok]
    lo = np.minimum(np.minimum(a, b), c)
    hi = np.maximum(np.maximum(a, b), c)
    gx0 = np.maximum(np.ceil((lo[:, 0] - grid.x0) / grid.h - 1e-9).astype(np.int64), 0)
    gx1 = np.minimum(np.floor((hi[:, 0] - grid.x0) / grid.h + 1e-9).astype(np.int64), grid.nx - 1)
    gy0 = np.maximum(np.ceil((lo[:, 1] - grid.y0) / grid.h - 1e-9).astype(np.int64), 0)
    gy1 = np.minimum(np.floor((hi[:, 1] - grid.y0) / grid.h + 1e-9).astype(np.int64), grid.ny - 1)
    wx = np.maximum(gx1 - gx0 + 1, 0)
    wy = np.maximum(gy1 - gy0 + 1, 0)
    cnt = wx * wy
    if cnt.sum() == 0:
        return H.reshape(grid.nx, grid.ny)
    t = np.repeat(np.arange(len(a)), cnt)
    start = np.repeat(np.cumsum(cnt) - cnt, cnt)
    k = np.arange(cnt.sum()) - start
    gx = gx0[t] + k % wx[t]
    gy = gy0[t] + k // wx[t]
    px = grid.x0 + gx * grid.h
    py = grid.y0 + gy * grid.h
    A, Bv, C, D = a[t], b[t], c[t], det[t]
    l1 = ((Bv[:, 1] - C[:, 1]) * (px - C[:, 0]) + (C[:, 0] - Bv[:, 0]) * (py - C[:, 1])) / D
    l2 = ((C[:, 1] - A[:, 1]) * (px - C[:, 0]) + (A[:, 0] - C[:, 0]) * (py - C[:, 1])) / D
    l3 = 1 - l1 - l2
    inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
    z = l1 * A[:, 2] + l2 * Bv[:, 2] + l3 * C[:, 2]
    node = (gx * grid.ny + gy)[inside]
    np.maximum.at(H, node, z[inside])
    return H.reshape(grid.nx, grid.ny)


def harmonic_fill(values, known, valid):
    """Membrane (Laplace) interpolation of `values` from `known` nodes into the
    other `valid` nodes of a grid (5-point stencil, natural boundary where the
    grid has no data). The result is a 'flattened' surface: by the maximum
    principle it never bulges above or below its boundary data, which is what
    a chest wall under a mound should do."""
    nx, ny = values.shape
    unknown = valid & ~known
    out = np.where(known, values, np.nan)
    if not unknown.any():
        return out
    uid = -np.ones((nx, ny), np.int64)
    uid[unknown] = np.arange(unknown.sum())
    rows, cols, vals = [], [], []
    rhs = np.zeros(unknown.sum())
    deg = np.zeros(unknown.sum())
    I, J = np.nonzero(unknown)
    ids = uid[I, J]
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        I2, J2 = I + di, J + dj
        inb = (I2 >= 0) & (I2 < nx) & (J2 >= 0) & (J2 < ny)
        I2c, J2c = np.clip(I2, 0, nx - 1), np.clip(J2, 0, ny - 1)
        nb_valid = inb & valid[I2c, J2c]
        deg += nb_valid
        nk = nb_valid & known[I2c, J2c]
        np.add.at(rhs, ids[nk], values[I2c[nk], J2c[nk]])
        nu = nb_valid & unknown[I2c, J2c]
        rows.append(ids[nu])
        cols.append(uid[I2c[nu], J2c[nu]])
        vals.append(-np.ones(nu.sum()))
    rows.append(ids)
    cols.append(ids)
    # A tiny pull towards the mean keeps islands without known neighbours
    # (pure Neumann) solvable without visibly biasing the rest.
    eps = 1e-6
    rhs += eps * values[known].mean()
    vals.append(deg + eps)
    A = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(len(ids), len(ids)))
    z = spla.spsolve(A.tocsc(), rhs)
    out[I, J] = z
    return out
