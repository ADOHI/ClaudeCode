"""Injectivity gate: numpy port of fieldCheck / extremeCombos (web/src/core/validate.js).

det(I + sum_k w_k J_k) > 0 on a grid over each side's support, for every
corner of the slider space. A positive determinant means the bind-space map is
locally injective: no fold-over, so clothing layers keep their order.
"""

import numpy as np

from .field import slider_to_weights
from .vec import m3det


def extreme_combos():
    """Every corner of the slider space (size, style, lift, spread), JS order."""
    combos = []
    for size in (-1, 1):
        for style in (0, 1) if size > 0 else (0,):
            for lift in (-1, 0, 1):
                for spread in (-1, 0, 1):
                    combos.append({"size": size, "style": style, "lift": lift, "spread": spread})
    return combos


def label(c):
    return " ".join(f"{k}={v}" for k, v in c.items())


def grid_points(field, res=14):
    """Grid of the JS fieldCheck: cell centres of the side-frame box, both sides,
    only points inside the support. Returns (P (N, 3), w (N,))."""
    x, y, z = field.box["x"], field.box["y"], field.box["z"]
    t = (np.arange(res) + 0.5) / res
    qi, qj, qk = np.meshgrid(x[0] + t * (x[1] - x[0]), y[0] + t * (y[1] - y[0]), z[0] + t * (z[1] - z[0]), indexing="ij")
    Q = np.stack([qi.ravel(), qj.ravel(), qk.ravel()], axis=-1)
    out = []
    for side in field.sides:
        qv = field.from_side_vec(side, Q)
        b = side.base
        P = np.stack([b[0] + qv[:, 0], b[1] + qv[:, 1], b[2] + qv[:, 2]], axis=-1)
        out.append(P)
    P = np.concatenate(out)
    w = field.weight(P)
    keep = w != 0
    return P[keep], w[keep]


def combo_dets(Js, targets, combos):
    """det(I + sum w_t J_t) for every combo: (n_combos, N)."""
    N = next(iter(Js.values())).shape[0]
    out = np.empty((len(combos), N))
    for ci, c in enumerate(combos):
        wt = slider_to_weights(**c)
        F = np.broadcast_to(np.eye(3), (N, 3, 3)).copy()
        for t in targets:
            a = wt.get(t, 0)
            if a:
                F += a * Js[t]
        out[ci] = m3det(F)
    return out


def field_check(field, res=14, combos=None):
    """Python fieldCheck: min det over the grid and all slider extremes, plus
    per-target local volume change."""
    combos = extreme_combos() if combos is None else combos
    T = field.targets
    P, w = grid_points(field, res)
    Js = {t: field.jacobian(t, P) for t in T}
    volume = {}
    wsum = float(w.sum())
    for t in T:
        det = m3det(Js[t] + np.eye(3)) - 1
        volume[t] = {
            "meanChange": float((det * w).sum() / max(wsum, 1e-12)),
            "maxAbsChange": float(np.abs(det).max()) if det.size else 0.0,
        }
    if P.shape[0] == 0:
        return {"minDet": float("inf"), "minAt": None, "minCombo": None, "samples": 0, "volume": volume, "injective": True}
    D = combo_dets(Js, T, combos)
    ci, pi = np.unravel_index(np.argmin(D), D.shape)
    min_det = float(D[ci, pi])
    return {
        "minDet": min_det,
        "minAt": P[pi].tolist(),
        "minCombo": label(combos[ci]),
        "samples": int(P.shape[0]),
        "volume": volume,
        "injective": min_det > 0,
    }
