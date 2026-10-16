"""Inverse rest shape (sag-free initialization).

The authored mesh is taken to be the equilibrium under the default loads
(gravity g0). The rest shape X_rest is found by the fixed-point iteration

    X_rest <- X_rest + (X_target - x_eq(X_rest))

(the 'two-stage initialization' family, Hsu et al. 2022 / STAGED, in its
simplest form). Each x_eq is a full Newton solve warm-started at the target.
Load cases are later applied relative to x_eq(X_rest), so weight 0 of every
target reproduces the authored shape exactly and the inverse error only
enters as a second-order change of the linearization point.
"""

import time

import numpy as np

from .fem import newton


def inverse_rest(model, X_target, loads, tol=1e-7, maxit=40, solver=None, anderson=5, log=None):
    """Returns (X_rest, x_eq, info). The plain fixed-point map converges
    linearly (soft, strongly sheared regions slow it down), so it is wrapped
    in Anderson acceleration (depth `anderson`, 0 = off) with a fallback to
    the plain step whenever the accelerated rest shape inverts a tet or
    makes the error grow."""
    solver = dict(solver or {})
    t0 = time.time()
    free = ~model.fixed
    X_rest = np.array(X_target, float)
    hist = []
    x = X_target.copy()
    newton_iters = 0
    dX, dF = [], []  # Anderson history (differences of iterates / residuals)
    prev = None
    accepted_aa = 0
    for it in range(maxit):
        try:
            model.set_rest(X_rest)
        except ValueError:
            if prev is None:
                raise
            # Accelerated step inverted a rest tet: take the plain step instead.
            X_rest, dX, dF = prev[0] + prev[1], [], []
            model.set_rest(X_rest)
        model.set_loads(**loads)
        f_ref = np.linalg.norm(model.f_ext.ravel()[model.free_dof])
        x, info = newton(model, X_target, tol=solver.get('tol', 1e-10), maxit=solver.get('maxit', 60), f_ref=f_ref)
        newton_iters += info['iterations']
        err = x - X_target
        e = float(np.linalg.norm(err[free], axis=1).max())
        if log:
            log(f'  inverse {it:2d}: max |x_eq - X_target| = {e:.3e} S  (newton {info["iterations"]}, residual {info["residual"]:.1e})')
        if prev is not None and hist and e > hist[-1] and dX:
            # Acceleration overshot: restart the history from the plain step.
            dX, dF = [], []
        hist.append(e)
        if e <= tol:
            break
        f = np.where(free[:, None], -err, 0.0).ravel()
        xk = X_rest.ravel().copy()
        if prev is not None:
            dX.append(xk - prev[2])
            dF.append(f - prev[3])
            dX, dF = dX[-anderson:], dF[-anderson:]
        plain = -err * free[:, None]
        step = plain.ravel()
        if anderson and dF:
            Fm = np.stack(dF, 1)
            g, *_ = np.linalg.lstsq(Fm, f, rcond=None)
            step = f - (np.stack(dX, 1) + Fm) @ g
            accepted_aa += 1
        prev = (X_rest.copy(), plain, xk, f)
        X_rest = (xk + step).reshape(-1, 3)
    return X_rest, x, {
        'iterations': len(hist), 'error_max_S': hist[-1], 'history': hist,
        'newton_iterations': newton_iters, 'seconds': time.time() - t0, 'anderson_steps': accepted_aa,
        'residual': info['residual'], 'min_det': info['min_det'],
        'rest_min_volume_ratio': float((model.V_rest / _vol(model, X_target)).min()),
    }


def _vol(model, X):
    a = X[model.tets[:, 0]]
    D = np.stack([X[model.tets[:, k]] - a for k in (1, 2, 3)], axis=2)
    return np.linalg.det(D) / 6
