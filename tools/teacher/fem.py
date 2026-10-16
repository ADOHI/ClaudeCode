"""Quasi-static hyperelastic model of the proxy volume and its Newton solver.

Total potential (body-frame / S units, tissue shear modulus = 1):

    E(x) = sum_t V_t Psi_SNH(F_t)                  tissue, growth via F = Ds (Fg Dm)^-1
         - f_ext . x                               gravity, lateral body force (dead loads)
         + sum_i k_i / 2 max(0, |x_i - A_i| - l0_i)^2   tension-only Cooper ligaments
         + tau * area(front surface)               skin tension (membrane prestress)

Chest wall and the rim of the volume are Dirichlet (fixed at their authored
positions). Equilibrium is found directly by Newton's method on grad E = 0
(projected Hessian far from the solution, exact Hessian near it for quadratic
convergence) instead of damping a dynamic solver, so the reported residual is
the true force imbalance.
"""

import time

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from . import snh
from .volume import TISSUE


def tri_area_terms(x, tris):
    """Area of triangles and gradient (M, 3 verts, 3)."""
    a, b, c = x[tris[:, 0]], x[tris[:, 1]], x[tris[:, 2]]
    n = np.cross(b - a, c - a)
    ln = np.linalg.norm(n, axis=1)
    nh = n / np.maximum(ln, 1e-300)[:, None]
    g = 0.5 * np.stack([np.cross(nh, c - b), np.cross(nh, a - c), np.cross(nh, b - a)], 1)
    return 0.5 * ln, g, nh, ln


def tri_area_hessian(x, tris, project=False):
    a, b, c = x[tris[:, 0]], x[tris[:, 1]], x[tris[:, 2]]
    _, _, nh, ln = tri_area_terms(x, tris)
    e = [c - b, a - c, b - a]
    M = [snh._hat(ei) for ei in e]  # dn/dx_i = [e_i]x
    Pn = np.eye(3)[None] - nh[:, :, None] * nh[:, None, :]
    Nh = snh._hat(nh)
    C = {(0, 1): -1, (0, 2): 1, (1, 0): 1, (1, 2): -1, (2, 0): -1, (2, 1): 1}
    H = np.zeros((len(tris), 9, 9))
    for i in range(3):
        for j in range(3):
            blk = 0.5 * np.einsum('mki,mkl,mlj->mij', M[i], Pn, M[j]) / ln[:, None, None]
            if (i, j) in C:
                blk = blk + 0.5 * C[(i, j)] * Nh
            H[:, 3 * i:3 * i + 3, 3 * j:3 * j + 3] = blk
    if project:
        w, V = np.linalg.eigh(H)
        H = np.einsum('mij,mj,mkj->mik', V, np.maximum(w, 0.0), V)
    return H


class Model:
    """Proxy volume + materials + loads. Positions are (N, 3) body / S."""

    def __init__(self, vol, mu, lam, rho, ligaments=None):
        self.vol = vol
        self.tets = vol.tets
        self.N = vol.n_nodes
        self.mu = np.asarray(mu, float)
        self.lam = np.asarray(lam, float)
        self.rho = np.asarray(rho, float)
        self.fixed = vol.fixed.copy()
        self.free_dof = np.repeat(~self.fixed, 3)
        self.nfree = int(self.free_dof.sum())
        dof_map = -np.ones(3 * self.N, np.int64)
        dof_map[self.free_dof] = np.arange(self.nfree)
        self.dof_map = dof_map
        self.top = vol.top_tris
        self.lig = ligaments  # dict(nodes, anchors, weight, kappa)
        self.Fg = None
        self.tension = 0.0
        self.prestress = 0.0
        self._pattern()

    # ---- sparsity pattern of the free-free system, built once ----
    def _pattern(self):
        tdof = (3 * self.tets[:, :, None] + np.arange(3)).reshape(-1, 12)
        sdof = (3 * self.top[:, :, None] + np.arange(3)).reshape(-1, 9)
        parts = [(tdof, 12), (sdof, 9)]
        if self.lig is not None:
            ldof = 3 * self.lig['nodes'][:, None] + np.arange(3)
            parts.append((ldof, 3))
        rows, cols = [], []
        for d, k in parts:
            rows.append(np.repeat(d, k, axis=1).ravel())
            cols.append(np.tile(d, (1, k)).ravel())
        rows = self.dof_map[np.concatenate(rows)]
        cols = self.dof_map[np.concatenate(cols)]
        keep = (rows >= 0) & (cols >= 0)
        key = rows[keep] * self.nfree + cols[keep]
        ukey, inv = np.unique(key, return_inverse=True)
        self._keep, self._inv = keep, inv
        r = ukey // self.nfree
        self._indices = (ukey % self.nfree).astype(np.int32)
        self._indptr = np.concatenate([[0], np.cumsum(np.bincount(r, minlength=self.nfree))]).astype(np.int32)
        self._nnz = len(ukey)

    # ---- rest state and loads ----
    def set_rest(self, X_rest):
        self.X_rest = np.asarray(X_rest, float).copy()
        a = self.X_rest[self.tets[:, 0]]
        self.Dm = np.stack([self.X_rest[self.tets[:, k]] - a for k in (1, 2, 3)], axis=2)
        V0 = np.linalg.det(self.Dm) / 6
        if np.any(V0 <= 0):
            raise ValueError(f'inverted rest tets: {(V0 <= 0).sum()}')
        self.V_rest = V0
        if self.lig is not None:
            self.lig_len = np.linalg.norm(self.X_rest[self.lig['nodes']] - self.lig['anchors'], axis=1)
        self._update_rest()

    def set_loads(self, Fg=None, gamma=0.0, gdir=(0, -1, 0), prestress=0.0, tension=0.0, lateral=0.0):
        self.Fg = None if Fg is None else np.asarray(Fg, float)
        self.gamma = float(gamma)
        self.gdir = np.asarray(gdir, float)
        self.prestress = float(prestress)
        self.tension = float(tension)
        self.lateral = float(lateral)
        self._update_rest()

    def _update_rest(self):
        if not hasattr(self, 'Dm'):
            return
        Dg = self.Dm if self.Fg is None else np.einsum('tij,tjk->tik', self.Fg, self.Dm)
        self.Bm = np.linalg.inv(Dg)
        self.V = np.linalg.det(Dg) / 6  # grown rest volume (mass grows with it)
        # Q[n, c] = dF_rc / dx_nr (shape functions gradients in the grown rest frame)
        Q = np.empty((len(self.tets), 4, 3))
        Q[:, 1:, :] = self.Bm
        Q[:, 0, :] = -self.Bm.sum(axis=1)
        self.Q = Q
        f = np.zeros((self.N, 3))
        if getattr(self, 'gamma', 0.0):
            ft = (self.gamma * self.rho * self.V / 4)[:, None] * self.gdir[None, :]
            for k in range(4):
                np.add.at(f, self.tets[:, k], ft)
        if getattr(self, 'lateral', 0.0):
            v = self.vol
            ft = np.zeros((len(self.tets), 3))
            ft[:, 0] = self.lateral * self.V * v.growth_w * v.side / 4
            for k in range(4):
                np.add.at(f, self.tets[:, k], ft)
        self.f_ext = f
        if self.lig is not None:
            L = self.lig_len
            self.lig_l0 = (1 - self.prestress) * L
            self.lig_k = self.lig['kappa'] * self.lig['weight'] / np.maximum(L, 1e-9) ** 2

    # ---- energy, gradient, Hessian ----
    def deformation(self, x):
        a = x[self.tets[:, 0]]
        Ds = np.stack([x[self.tets[:, k]] - a for k in (1, 2, 3)], axis=2)
        return Ds @ self.Bm

    def min_det(self, x):
        return float(np.linalg.det(self.deformation(x)).min())

    def _lig_terms(self, x):
        n = self.lig['nodes']
        d = x[n] - self.lig['anchors']
        l = np.linalg.norm(d, axis=1)
        s = np.maximum(l - self.lig_l0, 0.0)
        return n, d, l, s

    def energy(self, x):
        F = self.deformation(x)
        if np.linalg.det(F).min() <= 0:
            return np.inf
        E = float(np.dot(self.V, snh.psi(F, self.mu, self.lam)))
        E -= float(np.sum(self.f_ext * x))
        if self.tension:
            E += self.tension * float(tri_area_terms(x, self.top)[0].sum())
        if self.lig is not None:
            _, _, _, s = self._lig_terms(x)
            E += 0.5 * float(np.dot(self.lig_k, s * s))
        return E

    def gradient(self, x):
        F = self.deformation(x)
        P = snh.pk1(F, self.mu, self.lam)
        gt = self.V[:, None, None] * np.einsum('tnc,trc->tnr', self.Q, P)
        g = np.zeros((self.N, 3))
        for k in range(4):
            np.add.at(g, self.tets[:, k], gt[:, k])
        g -= self.f_ext
        if self.tension:
            _, ga, _, _ = tri_area_terms(x, self.top)
            for k in range(3):
                np.add.at(g, self.top[:, k], self.tension * ga[:, k])
        if self.lig is not None:
            n, d, l, s = self._lig_terms(x)
            np.add.at(g, n, (self.lig_k * s / np.maximum(l, 1e-12))[:, None] * d)
        return g

    def hessian(self, x, project=True):
        """Free-free block of the Hessian (CSR)."""
        F = self.deformation(x)
        D = snh.dpdf(F, self.mu, self.lam, project=project)
        D = D.reshape(-1, 3, 3, 3, 3)  # [c, r, d, s] from vec index 3c + r
        T1 = np.einsum('tnc,tcrds->tnrds', self.Q, D)
        Ht = self.V[:, None, None, None, None] * np.einsum('tnrds,tmd->tnrms', T1, self.Q)
        vals = [Ht.reshape(-1)]
        Hs = tri_area_hessian(x, self.top, project=project) * self.tension if self.tension else np.zeros((len(self.top), 9, 9))
        vals.append(Hs.reshape(-1))
        if self.lig is not None:
            n, d, l, s = self._lig_terms(x)
            e = d / np.maximum(l, 1e-12)[:, None]
            act = s > 0
            ee = e[:, :, None] * e[:, None, :]
            ratio = np.where(act, self.lig_l0 / np.maximum(l, 1e-12), 1.0)
            Hl = self.lig_k[:, None, None] * (ee + (1 - ratio)[:, None, None] * (np.eye(3)[None] - ee))
            Hl[~act] = 0.0
            vals.append(Hl.reshape(-1))
        v = np.concatenate(vals)[self._keep]
        data = np.bincount(self._inv, weights=v, minlength=self._nnz)
        return sp.csr_matrix((data, self._indices, self._indptr), shape=(self.nfree, self.nfree))

    def lumped_mass(self):
        m = np.zeros(self.N)
        for k in range(4):
            np.add.at(m, self.tets[:, k], self.rho * self.V / 4)
        return m

    def tissue_volume(self, x):
        t = self.vol.material == TISSUE
        a = x[self.tets[t, 0]]
        Ds = np.stack([x[self.tets[t, k]] - a for k in (1, 2, 3)], axis=2)
        return float(np.linalg.det(Ds).sum() / 6)


def newton(model, x0, tol=1e-10, maxit=80, switch=1e-3, f_ref=None, stall=1e-7, log=None):
    """Minimize model.energy from x0 (fixed nodes keep their x0 positions).

    Relative residual = ||grad E||_free / f_ref (default: the residual at x0,
    i.e. the out-of-balance force the load change created). Below `stall`
    the iteration also stops when round-off keeps the residual from halving
    over three steps (double precision floor). Returns (x, info).
    """
    t0 = time.time()
    x = np.array(x0, float)
    free = model.free_dof
    g = model.gradient(x).ravel()[free]
    gn = float(np.linalg.norm(g))
    ref = float(f_ref) if f_ref else max(gn, 1e-300)
    E = model.energy(x)
    if not np.isfinite(E):
        raise ValueError('start state has inverted tets')
    hist = [gn / ref]
    info = {'iterations': 0, 'exact_steps': 0, 'linesearch_cuts': 0, 'stalled': False}
    for it in range(maxit):
        if gn <= tol * ref:
            break
        if gn <= stall * ref and len(hist) > 3 and hist[-1] > 0.5 * hist[-4]:
            info['stalled'] = True
            break
        use_exact = gn <= switch * ref
        d = None
        for exact in ((True, False) if use_exact else (False,)):
            H = model.hessian(x, project=not exact)
            try:
                d = spla.splu(H.tocsc(), permc_spec='MMD_AT_PLUS_A').solve(-g)
            except RuntimeError:
                d = None
                continue
            if np.dot(d, g) < 0 and np.all(np.isfinite(d)):
                info['exact_steps'] += int(exact)
                break
            d = None
        if d is None:
            raise RuntimeError('no descent direction')
        alpha = 1.0
        dg = float(np.dot(d, g))
        ok = False
        while alpha >= 1e-8:
            xn = x.copy()
            xn.reshape(-1)[free] += alpha * d
            En = model.energy(xn)
            if np.isfinite(En):
                gnew = model.gradient(xn).ravel()[free]
                gnn = float(np.linalg.norm(gnew))
                # Armijo on energy; near convergence energy differences drown
                # in round-off, so a clear drop of the residual also counts.
                if En <= E + 1e-4 * alpha * dg or (gn < 1e-3 * ref and gnn < 0.5 * gn):
                    ok = True
                    break
            alpha *= 0.5
            info['linesearch_cuts'] += 1
        if not ok:
            if gn <= stall * ref:
                info['stalled'] = True
                break
            raise RuntimeError(f'line search failed at residual {gn / ref:.2e}')
        x, E, g, gn = xn, En, gnew, gnn
        hist.append(gn / ref)
        info['iterations'] = it + 1
        if log:
            log(f'    newton {it + 1:2d}  |g|/ref {gn / ref:.3e}  alpha {alpha:.3g}  {"exact" if use_exact else "proj"}')
    info.update(residual=gn / ref, residual_abs=gn, f_ref=ref, history=hist, seconds=time.time() - t0,
                min_det=model.min_det(x), converged=bool(gn <= tol * ref or info['stalled']))
    return x, info
