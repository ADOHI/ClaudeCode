"""Small dense solvers shared by distill and profile_fit.

The student field is linear in its amplitudes, so every fit here is a
quadratic program  min 1/2 x'Hx - g'x  s.t.  Cx >= d  with a few hundred
unknowns. The linear constraints are linearized injectivity conditions
(det(I + sum w J) >= tau at grid points, see ``det_rows``).
"""

import numpy as np
import scipy.linalg as sla
import scipy.optimize as sopt

from .field import slider_to_weights
from .vec import m3cof, m3det


def _cho(H):
    """Cholesky factor of symmetric positive (semi)definite H, jittered if needed."""
    H = 0.5 * (H + H.T)
    scale = max(float(np.trace(H)) / max(H.shape[0], 1), 1e-300)
    jitter = 0.0
    for _ in range(8):
        try:
            return sla.cho_factor(H + jitter * np.eye(H.shape[0]), lower=True, check_finite=False)
        except np.linalg.LinAlgError:
            jitter = scale * 1e-12 if jitter == 0 else jitter * 100
    raise np.linalg.LinAlgError("matrix not positive definite even with jitter")


def solve_spd(H, g):
    """H x = g for symmetric positive (semi)definite H (g may have columns)."""
    return sla.cho_solve(_cho(H), g, check_finite=False)


def solve_qp(H, g, C=None, d=None):
    """min 1/2 x'Hx - g'x  s.t.  C x >= d  (H positive definite).

    Solved in the dual: x = H^-1 (g + C' lam), lam >= 0 minimizes
    1/2 lam' M lam - lam' (d - C H^-1 g), M = C H^-1 C'. That bound-constrained
    problem is an NNLS on the Cholesky factor of M, which has an exact finite
    active set (better than a penalty for a handful of constraints).
    Returns (x, lam).
    """
    cf = _cho(H)
    x0 = sla.cho_solve(cf, g, check_finite=False)
    if C is None or len(C) == 0:
        return x0, np.zeros(0)
    if np.all(C @ x0 - d >= 0):
        return x0, np.zeros(len(C))
    HiC = sla.cho_solve(cf, C.T, check_finite=False)  # H^-1 C'
    M = C @ HiC
    M = 0.5 * (M + M.T)
    q = d - C @ x0
    m = M.shape[0]
    jitter = 1e-10 * max(float(np.trace(M)) / m, 1e-300)
    L = np.linalg.cholesky(M + jitter * np.eye(m))
    # min 1/2 lam'(L L')lam - lam'q  <=>  min ||L' lam - L^-1 q||^2, lam >= 0
    lam, _ = sopt.nnls(L.T, sla.solve_triangular(L, q, lower=True), maxiter=50 * m)
    return x0 + HiC @ lam, lam


def det_rows(J0s, Jcols, targets, var_targets, combos, pairs):
    """Linearized injectivity constraints.

    For each (point index i, combo index c) in `pairs`:
        det(F0) + sum_t w_t <cof(F0), Jcols_i (x_t - x0_t)> >= tau
    J0s:   {target: (N, 3, 3)} current Jacobians at the constraint points
    Jcols: (N, 9, K) Jacobian columns of the dictionary at those points
    Returns (rows (len(pairs), K * len(var_targets)), det0 (len(pairs),)).
    """
    K = Jcols.shape[-1]
    nv = len(var_targets)
    rows = np.zeros((len(pairs), K * nv))
    det0 = np.zeros(len(pairs))
    for r, (i, c) in enumerate(pairs):
        wt = slider_to_weights(**combos[c])
        F = np.eye(3)
        for t in targets:
            if wt.get(t, 0):
                F = F + wt[t] * J0s[t][i]
        det0[r] = m3det(F)
        cof = m3cof(F).reshape(9)
        g = cof @ Jcols[i]  # d det / d x_t per unit weight
        for vi, t in enumerate(var_targets):
            if wt.get(t, 0):
                rows[r, vi * K : (vi + 1) * K] = wt[t] * g
    return rows, det0
