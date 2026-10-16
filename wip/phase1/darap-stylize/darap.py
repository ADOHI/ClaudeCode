"""Normal-driven ARAP ("dARAP") with Dirichlet anchors, CPU (NumPy / SciPy).

Method: Geometry in Style: 3D Stylization via Surface Normal Deformation
(Dinh, Lang, Kim, Stein, Hanocka, CVPR 2025; reference code MIT,
github.com/threedle/geometry-in-style). Their deformation is one ARAP
local/global step whose local Procrustes problem gets an extra term pulling the
rotated vertex normal onto a target normal. This is our own implementation
with three deliberate differences:

* The energy is the exact spokes-and-rims elastic energy of Chao et al. 2010
  ("A simple geometric model for elastic deformations", SIGGRAPH 2010): every
  triangle's three edges belong to the cell of each of its three vertices,
  with half-cotangent weights (negative ones clamped to 0). Local and global
  steps then minimise one energy exactly, so iterating them is block
  coordinate descent with monotonically decreasing energy (the reference code
  uses an approximate, per-directed-edge cell and stops after one step):

      E(x, R) = sum_t sum_{i in t} sum_{(j,k) in t} c_jk |(x_j - x_k) - R_i (X_j - X_k)|^2
              + lam * sum_i a_i |R_i n_i - t_i|^2

  X rest positions, n_i rest normals, t_i target normals, a_i lumped area.
  lam is dimensionless (both terms scale with length^2). On a regular mesh the
  reference implementation's lambda is about 4x ours (cot a + cot b Laplacian
  weights and doubly counted spokes).
* Dirichlet anchors: every vertex outside the region of interest keeps its
  rest position (the reference pins one vertex). The free vertices are
  solved from L_ff x_f = b_f - L_fa x_a with L_ff factorised once (SuperLU).
* Iterated to convergence instead of a single step, so the result is a
  property of the target normals and lam, not of the iteration count.
"""

import time

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from scipy.sparse.csgraph import connected_components

from .surface import lumped_area, vertex_normals


def cot_weights(V, F, clamp=(0.0, 1e3)):
    """Half cotangent of the angle at corner k, for the edge opposite it.
    Columns: edge 0 = (F1, F2), edge 1 = (F2, F0), edge 2 = (F0, F1)."""
    c = np.empty((len(F), 3))
    for k in range(3):
        a = V[F[:, (k + 1) % 3]] - V[F[:, k]]
        b = V[F[:, (k + 2) % 3]] - V[F[:, k]]
        cr = np.linalg.norm(np.cross(a, b), axis=1)
        c[:, k] = 0.5 * np.einsum('ij,ij->i', a, b) / np.maximum(cr, 1e-300)
    # Negative weights (obtuse corners) would make L indefinite; clamping keeps
    # the energy a sum of squares, and local + global stay consistent because
    # both use the same weights.
    return np.clip(c, clamp[0], clamp[1])


def edge_vectors(X, F):
    """(m, 3, 3): edge k goes from F[:, k+1] to F[:, k+2] (opposite corner k)."""
    return np.stack([X[F[:, (k + 2) % 3]] - X[F[:, (k + 1) % 3]] for k in range(3)], 1)


def procrustes(Sm):
    """argmax_{R in SO(3)} tr(R S) for a batch of 3x3 S = U diag V^T: R = V U^T."""
    U, _, Vt = np.linalg.svd(Sm)
    R = np.einsum('nji,nkj->nik', Vt, U)  # V U^T
    bad = np.linalg.det(R) < 0
    if bad.any():
        U = U.copy()
        U[bad, :, 2] *= -1  # flip the axis of the smallest singular value
        R[bad] = np.einsum('nji,nkj->nik', Vt[bad], U[bad])
    return R


class DARAP:
    """dARAP on a triangle surface with every non-free vertex anchored.

    V (n,3) rest positions, F (m,3) triangles, free (n,) bool. Only the free
    vertices move; vertices outside the free set keep their rest position
    exactly (displacement 0, not merely small).
    """

    def __init__(self, V, F, free, cot_clamp=(0.0, 1e3)):
        t0 = time.perf_counter()
        V = np.asarray(V, float)
        F = np.asarray(F, np.int64)
        free = np.asarray(free, bool).copy()
        n = len(V)
        self.n_input = n
        # A free component that never touches a fixed vertex has no Dirichlet
        # data (L_ff singular); keep it rigidly at rest instead.
        touch = free[F].any(1)
        Ft = F[touch]
        E = np.concatenate([Ft[:, [0, 1]], Ft[:, [1, 2]], Ft[:, [2, 0]]])
        G = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n))
        _, lab = connected_components(G + G.T, directed=False)
        has_anchor = np.zeros(lab.max() + 1, bool)
        used = np.unique(Ft)
        has_anchor[np.unique(lab[used[~free[used]]])] = True
        orphan = free & ~has_anchor[lab]
        self.orphans = int(orphan.sum())
        free &= ~orphan
        self.free_input = free

        # Ring of anchors around the free set (A1) and active triangles: all
        # triangles incident to free or A1 vertices, so every vertex whose
        # rotation reaches a free vertex has its complete cell.
        touch = free[F].any(1)
        ring = np.zeros(n, bool)
        ring[F[touch].ravel()] = True
        rot_set = ring | free  # free ∪ A1
        act = rot_set[F].any(1)
        Fa = F[act]
        verts = np.unique(Fa)
        loc = np.full(n, -1, np.int64)
        loc[verts] = np.arange(len(verts))
        self.verts = verts  # active vertex ids in the input numbering
        self.F = loc[Fa]
        self.X = V[verts]
        self.free = free[verts]
        self.rot = rot_set[verts]
        self.tri_free = free[Fa].any(1)  # triangles that reach free rows of b
        na = len(verts)

        self.c = cot_weights(self.X, self.F, cot_clamp)
        self.e = edge_vectors(self.X, self.F)
        self.N = vertex_normals(self.X, self.F)
        self.a = lumped_area(self.X, self.F)
        # vertex <- triangle incidence restricted to rotation vertices
        rows = self.F.ravel()
        cols = np.repeat(np.arange(len(self.F)), 3)
        keep = self.rot[rows]
        self.VT = sp.csr_matrix((np.ones(keep.sum()), (rows[keep], cols[keep])), shape=(na, len(self.F)))

        # L = 3 * cotan Laplacian with half-cot weights (each edge sits in the
        # cells of the triangle's 3 vertices).
        Ff, cf = self.F[self.tri_free], self.c[self.tri_free]
        I, J, Wt = [], [], []
        for k in range(3):
            i, j, w = Ff[:, (k + 1) % 3], Ff[:, (k + 2) % 3], 3 * cf[:, k]
            I += [i, j, i, j]
            J += [j, i, i, j]
            Wt += [-w, -w, w, w]
        L = sp.coo_matrix((np.concatenate(Wt), (np.concatenate(I), np.concatenate(J))), shape=(na, na)).tocsc()
        fi = np.nonzero(self.free)[0]
        ai = np.nonzero(~self.free)[0]
        self.fi, self.ai = fi, ai
        self.L_ff = L[fi][:, fi].tocsc()
        self.L_fa = L[fi][:, ai].tocsc()
        self.lu = spla.splu(self.L_ff, permc_spec='MMD_AT_PLUS_A') if len(fi) else None
        self.setup_seconds = time.perf_counter() - t0

    # --- steps ------------------------------------------------------------
    def local_step(self, x, T, lam):
        """Per-vertex rotation (rotation vertices only; others identity)."""
        ec = edge_vectors(x, self.F)
        C = np.einsum('mk,mki,mkj->mij', self.c, self.e, ec)  # sum_k c e e'^T per triangle
        Sm = (self.VT @ C.reshape(-1, 9)).reshape(-1, 3, 3)
        if lam:
            Sm += (lam * self.a)[:, None, None] * np.einsum('ni,nj->nij', self.N, T)
        R = np.broadcast_to(np.eye(3), Sm.shape).copy()
        R[self.rot] = procrustes(Sm[self.rot])
        return R

    def global_step(self, R, x):
        Ft = self.F[self.tri_free]
        M = R[Ft[:, 0]] + R[Ft[:, 1]] + R[Ft[:, 2]]
        b = np.zeros_like(x)
        e = self.e[self.tri_free]
        c = self.c[self.tri_free]
        for k in range(3):
            v = c[:, k, None] * np.einsum('mij,mj->mi', M, e[:, k])
            np.add.at(b, Ft[:, (k + 2) % 3], v)
            np.subtract.at(b, Ft[:, (k + 1) % 3], v)
        out = x.copy()
        if self.lu is not None:
            rhs = b[self.fi] - self.L_fa @ x[self.ai]
            out[self.fi] = self.lu.solve(rhs)
        return out

    def energy(self, x, R, T, lam):
        ec = edge_vectors(x, self.F)
        tri = np.nonzero(self.rot[self.F].any(1))[0]
        Ft, c, e, ec = self.F[tri], self.c[tri], self.e[tri], ec[tri]
        E = 0.0
        for corner in range(3):
            i = Ft[:, corner]
            m = self.rot[i]
            Re = np.einsum('mij,mkj->mki', R[i[m]], e[m])
            E += float(np.sum(c[m] * np.sum((ec[m] - Re) ** 2, axis=2)))
        if lam:
            r = np.einsum('nij,nj->ni', R, self.N) - T
            E += lam * float(np.sum((self.a * np.sum(r * r, 1))[self.rot]))
        return E

    # --- driver -----------------------------------------------------------
    def solve(self, T_active, lam, x0=None, tol=1e-7, step_tol=1e-9, maxit=2000, scale=1.0, history=False):
        """Iterate local/global steps until the relative energy decrease is
        below `tol` and the largest vertex step below step_tol * scale.

        T_active: (len(self.verts), 3) unit target normals for active vertices.
        Returns (x_active, info).
        """
        t0 = time.perf_counter()
        T = np.asarray(T_active, float)
        x = self.X.copy() if x0 is None else np.asarray(x0, float).copy()
        x[~self.free] = self.X[~self.free]
        R = self.local_step(x, T, lam)
        E_prev = self.energy(x, R, T, lam)
        E0 = E_prev
        hist = [E_prev] if history else None
        converged = False
        it = 0
        step = 0.0
        increases = 0
        for it in range(1, maxit + 1):
            x_new = self.global_step(R, x)
            step = float(np.max(np.linalg.norm(x_new - x, axis=1))) if len(x) else 0.0
            x = x_new
            R = self.local_step(x, T, lam)
            E = self.energy(x, R, T, lam)
            if hist is not None:
                hist.append(E)
            if E > E_prev * (1 + 1e-12) + 1e-30:
                increases += 1
            dE = (E_prev - E) / max(E_prev, 1e-300)
            E_prev = E
            if (E <= 1e-30 or dE < tol) and step < step_tol * scale:
                converged = True
                break
        info = {
            'iterations': it,
            'converged': converged,
            'energy_initial': E0,
            'energy': E_prev,
            'last_step': step,
            'energy_increases': increases,
            'seconds': time.perf_counter() - t0,
            'free': int(self.free.sum()),
            'active': int(len(self.verts)),
        }
        if hist is not None:
            info['history'] = hist
        return x, info

    def full(self, x_active, V):
        """Scatter active positions back into a copy of the full rest array."""
        out = np.array(V, float, copy=True)
        out[self.verts] = x_active
        return out


def normal_deviation(V, F, T, mask, weights=None):
    """Weighted mean angle (degrees) between the surface's vertex normals and
    target normals over `mask`."""
    N = vertex_normals(V, F)
    c = np.clip(np.einsum('ij,ij->i', N[mask], T[mask]), -1, 1)
    ang = np.degrees(np.arccos(c))
    w = np.ones(len(ang)) if weights is None else np.asarray(weights, float)[mask]
    return float(np.sum(ang * w) / max(np.sum(w), 1e-300))
