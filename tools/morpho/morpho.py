"""Bust morphometrics: Python mirror of web/src/core/morpho.js.

Same definitions, same defaults (camelCase keys so option dicts round-trip
through JSON), same arithmetic where it decides a branch, so the two agree to
~1e-9 (tests/test_parity.py runs both on the same inputs). Read the header of
morpho.js for the definitions of the landmarks and metrics; this file only
notes where Python needs care to match JavaScript:

- Math.round(x) rounds halves up; Python's round() rounds halves to even, so
  `jround` is floor(x + 0.5).
- NaN marks "no surface" in section profiles, as in the JS Float64Array.
- First-max / first-min tie breaking matches the JS loops (strict compares).

Units: S (shoulder-joint distance); body frame (origin, left, up, forward)
as built by field.js buildBodyFrame. Per side: u = outward, y = up, z = forward.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

DEG = 180.0 / math.pi

MORPHO_DEFAULTS: dict[str, Any] = {
    "step": 0.0025,
    "cell": 0.005,
    "search": 0.2,
    "capFit": 0.05,
    "reachUp": 0.4,
    "reachDown": 0.35,
    "reachLat": 0.3,
    "kneeFrac": 0.9,
    "kneeFit": 0.03,
    "foldFit": [0.015, 0.06],
    "foldMinDeg": 20,
    "edgeFrac": 0.1,
    "axisDepths": [0.2 + 0.025 * i for i in range(17)],
    "poleDepth": [0.15, 0.7],
    "straightTol": 0.01,
    "minProjection": 0.02,
    "minTransverse": 0.3,
    "holeJump": 0.15,
    "minMask": 0.5,
    "margin": 0.15,
}

METRICS = [
    ("upperPoleFrac", "UP:LP upper share", "%", True),
    ("tiltDeg", "apex tilt", "deg", False),
    ("upperSlopeDeg", "upper pole slope", "deg", False),
    ("upperConvexity", "upper pole convexity", "", False),
    ("lowerConvexity", "lower pole convexity", "", False),
    ("imfY", "IMF height", "S", False),
    ("projection", "projection", "S", False),
    ("baseWidth", "base width", "S", False),
    ("baseHeight", "base height", "S", False),
    ("projectionRatio", "projection / base width", "", False),
    ("divergenceDeg", "lateral divergence", "deg", False),
    ("turnDeg", "profile turn", "deg", False),
]

BANDS: dict[str, Any] = {
    "natural": {
        "label": "natural (Mallucci & Branford 2012)",
        "metrics": {
            "upperPoleFrac": {"lo": 0.42, "hi": 0.48, "scale": 0.05, "weight": 1},
            "tiltDeg": {"lo": 15, "hi": 25, "scale": 10, "weight": 1},
            "upperConvexity": {"lo": -0.04, "hi": 0.01, "scale": 0.02, "weight": 1},
            "lowerConvexity": {"lo": 0.01, "hi": 0.12, "scale": 0.02, "weight": 1},
            "imfRise": {"lo": -0.05, "hi": 0.0, "scale": 0.02, "weight": 0.5},
        },
    },
    "anime": {
        "label": "anime (hypothesis)",
        "hypothesis": True,
        "metrics": {
            "upperPoleFrac": {"lo": 0.47, "hi": 0.53, "scale": 0.05, "weight": 1},
            "tiltDeg": {"lo": 25, "hi": 30, "scale": 10, "weight": 1},
            "upperConvexity": {"lo": 0.01, "hi": 0.05, "scale": 0.02, "weight": 1},
            "lowerConvexity": {"lo": 0.01, "hi": 0.12, "scale": 0.02, "weight": 1},
            "imfRise": {"lo": 0.0, "hi": 0.05, "scale": 0.02, "weight": 0.5},
        },
    },
}

NOT_OK = {"flat", "hole", "apexOnSearchEdge", "imfOpen", "topOpen"}
MEAN_KEYS = [
    "upperPoleFrac", "upperPoleH", "lowerPoleH", "tiltDeg", "upperSlopeDeg", "upperConvexity",
    "lowerConvexity", "imfY", "imfDrop", "projection", "baseHeight", "baseWidth",
    "projectionRatio", "divergenceDeg", "turnDeg", "apexY", "nippleY",
]


def jround(x: float) -> int:
    """JavaScript Math.round (halves toward +inf)."""
    return int(math.floor(x + 0.5))


def is_num(v) -> bool:
    return isinstance(v, (int, float, np.floating)) and not isinstance(v, bool) and math.isfinite(v)


def nan(v) -> bool:
    return v != v


# ----------------------------------------------------------------- bands


def score_bands(m: dict, band: dict, reference: dict | None = None) -> dict:
    if (m or {}).get("ok") is False:
        return {"distance": None, "inside": False, "per": {}, "missing": list(band["metrics"])}
    acc = sw = 0.0
    inside = True
    per, missing = {}, []
    for k, b in band["metrics"].items():
        v = (m or {}).get(k)
        if k == "imfRise":
            v = m["imfY"] - reference["imfY"] if reference and reference.get("ok") is not False and is_num((m or {}).get("imfY")) and is_num(reference.get("imfY")) else None
        if not is_num(v):
            missing.append(k)
            continue
        d = max(0.0, b["lo"] - v, v - b["hi"]) / b["scale"]
        per[k] = {"value": v, "lo": b["lo"], "hi": b["hi"], "d": d}
        acc += b["weight"] * d * d
        sw += b["weight"]
        if d > 0:
            inside = False
    return {"distance": math.sqrt(acc / sw) if sw > 0 else None, "inside": sw > 0 and inside, "per": per, "missing": missing}


# ----------------------------------------------------------------- inputs


def select_triangles(index, vertex_count: int, groups, include=None, exclude=None) -> np.ndarray:
    """Flat triangle index of the material groups passing include/exclude
    (compiled regexes); overlapping groups counted once; no groups -> all."""
    idx = np.arange(vertex_count, dtype=np.int64) if index is None else np.asarray(index, dtype=np.int64)
    nt = len(idx) // 3
    if not groups:
        return idx[: nt * 3].copy()
    keep = np.zeros(nt, dtype=bool)
    for g in groups:
        name = g.get("material") or ""
        if include is not None and not include.search(name):
            continue
        if exclude is not None and exclude.search(name):
            continue
        t0 = g["start"] // 3
        t1 = min(nt, (g["start"] + g.get("count", len(idx))) // 3)
        keep[t0:t1] = True
    return idx[: nt * 3].reshape(-1, 3)[keep].reshape(-1)


def _to_body(frame, p):
    S = frame["S"]
    o, l, u, f = frame["origin"], frame["left"], frame["up"], frame["forward"]
    dx, dy, dz = p[..., 0] - o[0], p[..., 1] - o[1], p[..., 2] - o[2]
    return np.stack(
        [
            (dx * l[0] + dy * l[1] + dz * l[2]) / S,
            (dx * u[0] + dy * u[1] + dz * u[2]) / S,
            (dx * f[0] + dy * f[1] + dz * f[2]) / S,
        ],
        axis=-1,
    )


def _rot_body(frame, d):
    S = frame["S"]
    l, u, f = frame["left"], frame["up"], frame["forward"]
    return np.stack(
        [
            (d[..., 0] * l[0] + d[..., 1] * l[1] + d[..., 2] * l[2]) / S,
            (d[..., 0] * u[0] + d[..., 1] * u[1] + d[..., 2] * u[2]) / S,
            (d[..., 0] * f[0] + d[..., 1] * f[1] + d[..., 2] * f[2]) / S,
        ],
        axis=-1,
    )


def prepare_morpho(frame: dict, meshes: list[dict], apex, opts: dict | None = None, shoulder_y: float | None = None) -> dict:
    """See prepareMorpho in morpho.js. meshes: [{pos (n*3 or (n,3)), tris?,
    index?, mask?, deltas?: {name: array}}] in bind space."""
    o = {**MORPHO_DEFAULTS, **(opts or {})}
    est = [_to_body(frame, np.asarray(a, dtype=np.float64)) for a in apex]
    y_lo = min(est[0][1], est[1][1]) - max(o["search"], o["reachDown"]) - o["margin"]
    y_hi = max(est[0][1], est[1][1]) + max(o["search"], o["reachUp"]) + o["margin"]
    x_max = max(abs(est[0][0]), abs(est[1][0])) + max(o["search"], o["reachLat"]) + o["margin"]

    names: list[str] = []
    for m in meshes:
        for k in (m.get("deltas") or {}):
            if k not in names:
                names.append(k)
    Bs, Ds, Ts = [], {k: [] for k in names}, []
    base = 0
    for m in meshes:
        pos = np.asarray(m["pos"], dtype=np.float64).reshape(-1, 3)
        n = len(pos)
        tris = m.get("tris")
        if tris is None:
            tris = m.get("index")
        tris = np.arange(n, dtype=np.int64) if tris is None else np.asarray(tris, dtype=np.int64)
        T = tris[: (len(tris) // 3) * 3].reshape(-1, 3)
        B = _to_body(frame, pos)
        keep = np.ones(len(T), dtype=bool)
        mask = m.get("mask")
        if mask is not None:
            mk = np.asarray(mask, dtype=np.float64)
            keep &= (mk[T] >= o["minMask"]).all(axis=1)
        ty = B[T, 1]
        keep &= ~((ty.max(axis=1) < y_lo) | (ty.min(axis=1) > y_hi))
        tx = B[T, 0]
        keep &= ~((tx.max(axis=1) < -x_max) | (tx.min(axis=1) > x_max))
        T = T[keep]
        # compact the referenced vertices (order does not matter: maxima are order independent)
        used = np.unique(T)
        remap = np.full(n, -1, dtype=np.int64)
        remap[used] = np.arange(len(used)) + base
        Bs.append(B[used])
        Ts.append(remap[T])
        for k in names:
            d = (m.get("deltas") or {}).get(k)
            Ds[k].append(np.zeros((len(used), 3)) if d is None else _rot_body(frame, np.asarray(d, dtype=np.float64).reshape(-1, 3)[used]))
        base += len(used)
    S = frame["S"]
    return {
        "o": o,
        "S": S,
        "B": np.concatenate(Bs) if Bs else np.zeros((0, 3)),
        "tris": np.concatenate(Ts) if Ts else np.zeros((0, 3), dtype=np.int64),
        "D": {k: np.concatenate(v) for k, v in Ds.items()},
        "est": [list(map(float, e)) for e in est],
        "shoulderY": shoulder_y,
        "hipsY": frame["hipsY"] / S if "hipsY" in frame else None,
        "neckY": frame["neckY"] / S if "neckY" in frame else None,
    }


def deform_prepared(ctx: dict, weights: dict | None = None) -> np.ndarray:
    if not weights:
        return ctx["B"]
    P = ctx["B"].copy()
    for k, w in weights.items():
        d = ctx["D"].get(k)
        if d is None or not w:
            continue
        P += w * d
    return P


def measure_prepared(ctx: dict, weights: dict | None = None) -> dict:
    P = deform_prepared(ctx, weights)
    sides = [_measure_side(ctx, P, s, ctx["est"][i]) for i, s in enumerate((1, -1))]
    return {"sides": sides, "mean": _mean_metrics(sides), "ok": all(r["ok"] for r in sides)}


def measure_bust(frame, meshes, apex, opts=None, shoulder_y=None, weights=None) -> dict:
    return measure_prepared(prepare_morpho(frame, meshes, apex, opts, shoulder_y), weights)


def _shape_class(s, tol):
    if not is_num(s):
        return None
    return "convex" if s > tol else "concave" if s < -tol else "straight"


def _mean_metrics(sides):
    out: dict[str, Any] = {"ok": any(r["ok"] for r in sides)}
    good = [r for r in sides if r["ok"]]
    for k in MEAN_KEYS:
        v = [r.get(k) for r in good if is_num(r.get(k))]
        out[k] = sum(v) / len(v) if v else None
    tol = sides[0]["straightTol"] if sides else MORPHO_DEFAULTS["straightTol"]
    out["upperShape"] = _shape_class(out["upperConvexity"], tol)
    out["lowerShape"] = _shape_class(out["lowerConvexity"], tol)
    flags = []
    for r in sides:
        for f in r["flags"]:
            t = f"{r['side']}:{f}"
            if t not in flags:
                flags.append(t)
    out["flags"] = flags
    return out


# ----------------------------------------------------------------- profiles


class Profile:
    __slots__ = ("u0", "step", "z", "n")

    def __init__(self, u0, step, z):
        self.u0, self.step, self.z, self.n = u0, step, z, len(z)


def section_profile(P: np.ndarray, tris: np.ndarray, s: int, axis: str, c: float, u0: float, n: int, step: float) -> Profile:
    """Front envelope of the plane section (see sectionProfile)."""
    z = np.full(n, np.nan)
    cut, prm = (0, 1) if axis == "u" else (1, 0)
    V = P[tris]  # (m, 3, 3)
    C = V[:, :, cut] * (s if cut == 0 else 1)
    Q = V[:, :, prm] * (s if prm == 0 else 1)
    Z = V[:, :, 2]
    d = C - c
    neg = d < 0
    straddle = ~((neg[:, 0] == neg[:, 1]) & (neg[:, 1] == neg[:, 2]))
    for t in np.nonzero(straddle)[0]:
        dd, qq, zz3 = d[t], Q[t], Z[t]
        pts = []
        for k in range(3):
            k2 = (k + 1) % 3
            da, db = float(dd[k]), float(dd[k2])
            if (da < 0) == (db < 0):
                continue
            f = da / (da - db)
            pa, pb = float(qq[k]), float(qq[k2])
            za, zb = float(zz3[k]), float(zz3[k2])
            pts.append((pa + f * (pb - pa), za + f * (zb - za)))
        if len(pts) != 2:
            continue
        (ua, za), (ub, zb) = pts
        if ub < ua:
            (ua, za), (ub, zb) = (ub, zb), (ua, za)
        i0 = max(0, math.ceil((ua - u0) / step - 1e-9))
        i1 = min(n - 1, math.floor((ub - u0) / step + 1e-9))
        for i in range(i0, i1 + 1):
            u = u0 + i * step
            v = za + ((u - ua) / (ub - ua)) * (zb - za) if ub > ua else max(za, zb)
            if not (v <= z[i]):
                z[i] = v
    return Profile(u0, step, z)


def height_map_apex(P, tris, s, ue, ye, o):
    c, R = o["cell"], o["search"]
    n = jround((2 * R) / c)
    gu0, gy0 = ue - R, ye - R
    Z = np.full(n * n, np.nan)
    V = P[tris]
    X = V[:, :, 0] * s
    Y = V[:, :, 1]
    W = V[:, :, 2]
    x0a, x1a, y0a, y1a = X.min(axis=1), X.max(axis=1), Y.min(axis=1), Y.max(axis=1)
    sel = ~((x1a < gu0) | (x0a > gu0 + n * c) | (y1a < gy0) | (y0a > gy0 + n * c))
    for t in np.nonzero(sel)[0]:
        ax, bx, cx = (float(v) for v in X[t])
        ay, by, cy = (float(v) for v in Y[t])
        az, bz, cz = (float(v) for v in W[t])
        x0, x1 = min(ax, bx, cx), max(ax, bx, cx)
        y0, y1 = min(ay, by, cy), max(ay, by, cy)
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-18:
            continue
        i0 = max(0, math.ceil((x0 - gu0) / c - 0.5))
        i1 = min(n - 1, math.floor((x1 - gu0) / c - 0.5))
        j0 = max(0, math.ceil((y0 - gy0) / c - 0.5))
        j1 = min(n - 1, math.floor((y1 - gy0) / c - 0.5))
        if i1 < i0 or j1 < j0:
            continue
        ii = np.arange(i0, i1 + 1)
        jj = np.arange(j0, j1 + 1)
        px = gu0 + (ii + 0.5) * c
        py = gy0 + (jj + 0.5) * c
        PX, PY = np.meshgrid(px, py)
        l1 = ((by - cy) * (PX - cx) + (cx - bx) * (PY - cy)) / det
        l2 = ((cy - ay) * (PX - cx) + (ax - cx) * (PY - cy)) / det
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        if not inside.any():
            continue
        zz = l1 * az + l2 * bz + l3 * cz
        K = (jj[:, None] * n + ii[None, :])[inside]
        vals = zz[inside]
        cur = Z[K]
        upd = ~(vals <= cur)
        Z[K[upd]] = vals[upd]
    # max inside the search disk, on this side of the midline (row-major first max)
    jj, ii = np.divmod(np.arange(n * n), n)
    cu_all = gu0 + (ii + 0.5) * c
    du = cu_all - ue
    dy = gy0 + (jj + 0.5) * c - ye
    ok = ~np.isnan(Z) & ~(du * du + dy * dy > R * R) & ~(cu_all <= 0)
    if not ok.any():
        return None
    Zm = np.where(ok, Z, -np.inf)
    k = int(np.argmax(Zm))
    best = float(Z[k])
    bj, bi = divmod(k, n)
    cu, cyy, cz = gu0 + (bi + 0.5) * c, gy0 + (bj + 0.5) * c, best
    du0, dy0 = cu - ue, cyy - ye
    on_edge = math.sqrt(du0 * du0 + dy0 * dy0) > R - 2 * c
    h = o["capFit"]
    valid = ~np.isnan(Z)
    for _ in range(2):
        a = (cu_all - cu) / h
        b = (gy0 + (jj + 0.5) * c - cyy) / h
        sel2 = valid & ~(a * a + b * b > 1)
        if sel2.sum() < 12:
            break
        A_, B_ = a[sel2], b[sel2]
        rows = np.stack([np.ones_like(A_), A_, B_, A_ * A_, A_ * B_, B_ * B_], axis=1)
        q = least_squares(rows, Z[sel2])
        if q is None:
            break
        H00, H01, H11 = 2 * q[3], q[4], 2 * q[5]
        dt = H00 * H11 - H01 * H01
        if not (H00 < 0 and dt > 0):
            break
        sa = (-q[1] * H11 + q[2] * H01) / dt
        sb = (-q[2] * H00 + q[1] * H01) / dt
        if sa * sa + sb * sb > 1:
            break
        cu += sa * h
        cyy += sb * h
        cz = q[0] + q[1] * sa + q[2] * sb + q[3] * sa * sa + q[4] * sa * sb + q[5] * sb * sb
    return {"u": cu, "y": cyy, "z": cz, "onEdge": on_edge}


def least_squares(rows, vals):
    X = np.asarray(rows, dtype=np.float64)
    y = np.asarray(vals, dtype=np.float64)
    return solve((X.T @ X).tolist(), (X.T @ y).tolist())


def solve(A, b):
    """Partial-pivot Gaussian elimination, same steps as morpho.js solve()."""
    m = len(b)
    M = [list(map(float, A[i])) + [float(b[i])] for i in range(m)]
    for c in range(m):
        p = c
        for r in range(c + 1, m):
            if abs(M[r][c]) > abs(M[p][c]):
                p = r
        if abs(M[p][c]) < 1e-14:
            return None
        if p != c:
            M[p], M[c] = M[c], M[p]
        for r in range(c + 1, m):
            f = M[r][c] / M[c][c]
            if f == 0:
                continue
            for k in range(c, m + 1):
                M[r][k] -= f * M[c][k]
    x = [0.0] * m
    for r in range(m - 1, -1, -1):
        v = M[r][m]
        for k in range(r + 1, m):
            v -= M[r][k] * x[k]
        x[r] = v / M[r][r]
    return x


def _clamp_idx(i, n):
    return 0 if i < 0 else n - 1 if i >= n else i


def _sample_range(pr, ua, ub):
    i0 = max(0, math.ceil((ua - pr.u0) / pr.step - 1e-9))
    i1 = min(pr.n - 1, math.floor((ub - pr.u0) / pr.step + 1e-9))
    return i0, i1


def fit_quad1(pr, ua, ub):
    um, hw = (ua + ub) / 2, (ub - ua) / 2
    if not (hw > 0):
        return None
    i0, i1 = _sample_range(pr, ua, ub)
    if i1 < i0:
        return None
    ii = np.arange(i0, i1 + 1)
    zz = pr.z[ii]
    ok = ~np.isnan(zz)
    if ok.sum() < 5:
        return None
    t = (pr.u0 + ii[ok] * pr.step - um) / hw
    q = least_squares(np.stack([np.ones_like(t), t, t * t], axis=1), zz[ok])
    return None if q is None else {"c0": q[0], "c1": q[1], "c2": q[2], "um": um, "hw": hw}


def _fit_line(pr, ua, ub, uref):
    if not (ub > ua):
        return None
    i0, i1 = _sample_range(pr, ua, ub)
    if i1 < i0:
        return None
    ii = np.arange(i0, i1 + 1)
    zz = pr.z[ii]
    ok = ~np.isnan(zz)
    if ok.sum() < 4:
        return None
    x = pr.u0 + ii[ok] * pr.step - uref
    q = least_squares(np.stack([np.ones_like(x), x], axis=1), zz[ok])
    return None if q is None else {"c0": q[0], "c1": q[1]}


def _profile_apex(pr, i0, o):
    w = jround(o["capFit"] / pr.step)
    bi, best = -1, -math.inf
    for i in range(max(0, i0 - 2 * w), min(pr.n - 1, i0 + 2 * w) + 1):
        v = pr.z[i]
        if v > best:
            best, bi = float(v), i
    if bi < 0:
        return None
    cu = pr.u0 + bi * pr.step
    q = fit_quad1(pr, cu - o["capFit"], cu + o["capFit"])
    if q and q["c2"] < 0:
        t = -q["c1"] / (2 * q["c2"])
        if abs(t) <= 1:
            return {"u": q["um"] + t * q["hw"], "z": q["c0"] + q["c1"] * t + q["c2"] * t * t}
    return {"u": cu, "z": best}


def _fold_point(pr, K, A, o):
    a, b = o["foldFit"]
    lo = _fit_line(pr, K["u"] - b, K["u"] - a, K["u"])
    hi = _fit_line(pr, K["u"] + a, min(K["u"] + b, A["u"]), K["u"])
    if not lo or not hi:
        return None
    ang = abs(math.atan(hi["c1"]) - math.atan(lo["c1"])) * DEG
    if ang < o["foldMinDeg"]:
        return None
    return {"u": K["u"], "z": min(lo["c0"], K["z"])}


def _end_point(pr, i, i_to):
    d = 1 if i_to > i else -1
    k = i
    while (k <= i_to) if d > 0 else (k >= i_to):
        if not nan(pr.z[k]):
            return {"u": pr.u0 + k * pr.step, "z": float(pr.z[k])}
        k += d
    return None


def _knee(pr, iA, iRef, A, o):
    z, u0, step = pr.z, pr.u0, pr.step
    ref = _end_point(pr, iRef, iA)
    if not ref:
        return None
    tu, tz = ref["u"] - A["u"], ref["z"] - A["z"]
    L = math.sqrt(tu * tu + tz * tz)
    if not (L > 0):
        return None
    nu, nz = -tz / L, tu / L
    if nz > 0:
        nu, nz = -nu, -nz
    d = 1 if iRef > iA else -1
    i_end = jround((ref["u"] - u0) / step)
    dist = {}
    best, bi = 0.0, -1
    i = iA + d
    while (i < i_end) if d > 0 else (i > i_end):
        if not nan(z[i]):
            v = (u0 + i * step - A["u"]) * nu + (float(z[i]) - A["z"]) * nz
            dist[i] = v
            if v > best:
                best, bi = v, i
        i += d
    if bi < 0:
        return None
    thr = o["kneeFrac"] * best
    w = jround(o["kneeFit"] / step)
    sw = su = 0.0
    for sgn in (1, -1):
        for k in range(0 if sgn > 0 else 1, w + 1):
            ii = bi + sgn * k
            v = dist.get(ii)
            if v is None or v < thr:
                break
            sw += v - thr
            su += (v - thr) * (u0 + ii * step)
    u = su / sw if sw > 0 else u0 + bi * step
    return {"u": u, "z": _interp_at(pr, u)}


def scan_cross(pr, i_from, i_to, zc):
    z, u0, step = pr.z, pr.u0, pr.step
    d = 1 if i_to > i_from else -1
    prev = -1
    i = i_from
    while (i <= i_to) if d > 0 else (i >= i_to):
        zi = z[i]
        if not nan(zi):
            if zi <= zc:
                if prev < 0 or z[prev] == zi:
                    return {"u": u0 + i * step, "z": float(zi)}
                t = (z[prev] - zc) / (z[prev] - zi)
                ua, ub = u0 + prev * step, u0 + i * step
                return {"u": float(ua + t * (ub - ua)), "z": zc}
            prev = i
        i += d
    return None


def _valley_floor(pr, ia, ib, o):
    best, bi = math.inf, -1
    lo, hi = min(ia, ib), max(ia, ib)
    for i in range(lo, hi + 1):
        if pr.z[i] < best:
            best, bi = float(pr.z[i]), i
    if bi < 0:
        return None
    cu = pr.u0 + bi * pr.step
    q = fit_quad1(pr, cu - o["capFit"], cu + o["capFit"])
    if q and q["c2"] > 0:
        t = -q["c1"] / (2 * q["c2"])
        u = q["um"] + t * q["hw"]
        if abs(t) <= 1 and pr.u0 + lo * pr.step <= u <= pr.u0 + hi * pr.step:
            return {"u": u, "z": q["c0"] + q["c1"] * t + q["c2"] * t * t}
    return {"u": cu, "z": best}


def _interp_at(pr, u):
    f = (u - pr.u0) / pr.step
    i = max(0, min(pr.n - 2, math.floor(f)))
    t = f - i
    a, b = pr.z[i], pr.z[i + 1]
    if nan(a):
        return float(b)
    if nan(b):
        return float(a)
    return float(a + t * (b - a))


def _cap_axis(pr, iA, iHi, iLo, A, p, o):
    if not (p > 0):
        return None
    ds, ms = [], []
    for f in o["axisDepths"]:
        zc = A["z"] - f * p
        hi, lo = scan_cross(pr, iA, iHi, zc), scan_cross(pr, iA, iLo, zc)
        if not hi or not lo or hi["z"] != zc or lo["z"] != zc:
            continue
        ds.append(f * p)
        ms.append((hi["u"] + lo["u"]) / 2)
    if len(ds) < 2:
        return None
    sd = sm = 0.0
    for k in range(len(ds)):
        sd += ds[k]
        sm += ms[k]
    md, mm = sd / len(ds), sm / len(ds)
    sdd = sdm = 0.0
    for k in range(len(ds)):
        sdd += (ds[k] - md) * (ds[k] - md)
        sdm += (ds[k] - md) * (ms[k] - mm)
    if not (sdd > 0):
        return None
    beta = sdm / sdd
    return {"alpha": mm - beta * md, "beta": beta, "ds": ds, "ms": ms}


def _axis_exit(pr, ax, A, iA, o):
    z, u0, step, n = pr.z, pr.u0, pr.step, pr.n

    def g(i):
        return u0 + i * step - ax["alpha"] - ax["beta"] * (A["z"] - z[i])

    w = jround((2 * o["capFit"]) / step)
    for k in range(w + 1):
        for sgn in (1, -1):
            i, j = iA + sgn * k, iA + sgn * k + sgn
            if i < 0 or j < 0 or i >= n or j >= n or nan(z[i]) or nan(z[j]):
                continue
            gi, gj = g(i), g(j)
            if gi == 0:
                return {"u": u0 + i * step, "z": float(z[i])}
            if (gi < 0) != (gj < 0):
                t = gi / (gi - gj)
                return {"u": float(u0 + (i + sgn * t) * step), "z": float(z[i] + t * (z[j] - z[i]))}
    return None


def _arc_sagitta(pr, P, Q):
    q = fit_quad1(pr, P["u"], Q["u"])
    if not q:
        return None
    dy, dz = 2 * q["hw"], 2 * q["c1"]
    L2 = dy * dy + dz * dz
    return (-q["c2"] * dy) / L2 if L2 > 0 else None


def _has_hole(pr, ia, ib, jump):
    prev = math.nan
    for i in range(min(ia, ib), max(ia, ib) + 1):
        zi = pr.z[i]
        if nan(zi):
            return True
        if not nan(prev) and abs(zi - prev) > jump:
            return True
        prev = zi
    return False


# ----------------------------------------------------------------- one side


def _measure_side(ctx, P, s, est):
    o = ctx["o"]
    tris = ctx["tris"]
    r: dict[str, Any] = {"side": "L" if s > 0 else "R", "s": s, "ok": False, "flags": [], "straightTol": o["straightTol"]}
    flags = r["flags"]
    ue, ye = s * est[0], est[1]
    step = o["step"]

    hm = height_map_apex(P, tris, s, ue, ye, o)
    if not hm:
        flags.append("noSurface")
        return r
    if hm["onEdge"]:
        flags.append("apexOnSearchEdge")
    uA = hm["u"]

    y0 = hm["y"] - o["reachDown"] - 2 * o["capFit"]
    ny = jround((o["reachDown"] + o["reachUp"] + 4 * o["capFit"]) / step) + 1
    sag = section_profile(P, tris, s, "u", uA, y0, ny, step)
    A = _profile_apex(sag, jround((hm["y"] - y0) / step), o)
    if not A:
        flags.append("noSagittalApex")
        return r
    r["apex"] = [uA, A["u"], A["z"]]
    r["apexY"] = A["u"]
    iA = _clamp_idx(jround((A["u"] - y0) / step), ny)

    iLow = _clamp_idx(jround((A["u"] - o["reachDown"] - y0) / step), ny)
    I = _knee(sag, iA, iLow, A, o)
    if not I:
        flags.append("imfOpen")
        I = _end_point(sag, iLow, iA)
        if not I:
            return r
    else:
        c = _fold_point(sag, I, A, o)
        if c:
            I = c
        else:
            flags.append("imfSoft")
    p = A["z"] - I["z"]
    r["projection"] = p
    if not (p > o["minProjection"]):
        flags.append("flat")
    z_wall = I["z"] + o["edgeFrac"] * max(p, 0)

    L = scan_cross(sag, iA, iLow, z_wall) or I
    iUp = _clamp_idx(jround((A["u"] + o["reachUp"] - y0) / step), ny)
    T = scan_cross(sag, iA, iUp, z_wall)
    if not T:
        T = _knee(sag, iA, iUp, A, o)
        if T:
            flags.append("topFromKnee")
        else:
            flags.append("topOpen")
            T = _end_point(sag, iUp, iA)
            if not T:
                return r
    iT = _clamp_idx(jround((T["u"] - y0) / step), ny)
    iL = _clamp_idx(jround((L["u"] - y0) / step), ny)
    iI = _clamp_idx(jround((I["u"] - y0) / step), ny)
    if _has_hole(sag, min(iI, iL), iT, o["holeJump"]):
        flags.append("hole")

    ax = _cap_axis(sag, iA, iT, iL, A, A["z"] - max(T["z"], L["z"]), o)
    N = {"u": A["u"], "z": A["z"]}
    if ax:
        r["axis"] = ax
        r["tiltDeg"] = math.atan(-ax["beta"]) * DEG
        ex = _axis_exit(sag, ax, A, iA, o)
        if ex:
            N = ex
        else:
            flags.append("nippleAtApex")
    else:
        flags.append("noAxis")
    r["nipple"] = [uA, N["u"], N["z"]]
    r["nippleY"] = N["u"]
    r["top"] = [T["u"], T["z"]]
    r["bottom"] = [L["u"], L["z"]]
    r["imf"] = [I["u"], I["z"]]

    upH, loH = T["u"] - N["u"], N["u"] - L["u"]
    r["upperPoleH"], r["lowerPoleH"] = upH, loH
    r["baseHeight"] = T["u"] - L["u"]
    r["upperPoleFrac"] = upH / (upH + loH) if upH + loH > 0 else None
    pz = A["z"] - max(T["z"], L["z"])
    zc0, zc1 = A["z"] - o["poleDepth"][0] * pz, A["z"] - o["poleDepth"][1] * pz
    u0c, u1c = scan_cross(sag, iA, iT, zc0), scan_cross(sag, iA, iT, zc1)
    l0c, l1c = scan_cross(sag, iA, iL, zc0), scan_cross(sag, iA, iL, zc1)

    def exact(cr, zc):
        return bool(cr) and cr["z"] == zc

    if exact(u0c, zc0) and exact(u1c, zc1):
        r["upperConvexity"] = _arc_sagitta(sag, u0c, u1c)
        r["upperSlopeDeg"] = math.atan2(u1c["u"] - u0c["u"], u0c["z"] - u1c["z"]) * DEG
    else:
        flags.append("noUpperPole")
    if exact(l0c, zc0) and exact(l1c, zc1):
        r["lowerConvexity"] = _arc_sagitta(sag, l1c, l0c)
    else:
        flags.append("noLowerPole")
    r["upperShape"] = _shape_class(r.get("upperConvexity"), o["straightTol"])
    r["lowerShape"] = _shape_class(r.get("lowerConvexity"), o["straightTol"])
    if exact(u0c, zc0) and exact(u1c, zc1) and exact(l0c, zc0) and exact(l1c, zc1):
        a = (u0c["u"] - u1c["u"], u0c["z"] - u1c["z"])
        b = (l1c["u"] - l0c["u"], l1c["z"] - l0c["z"])
        la, lb = math.sqrt(a[0] * a[0] + a[1] * a[1]), math.sqrt(b[0] * b[0] + b[1] * b[1])
        if la > 0 and lb > 0:
            r["turnDeg"] = math.acos(max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * DEG
    r["imfY"] = I["u"]
    r["imfDrop"] = ctx["shoulderY"] - I["u"] if is_num(ctx["shoulderY"]) else None
    if is_num(ctx["hipsY"]) and is_num(ctx["neckY"]) and ctx["neckY"] > ctx["hipsY"]:
        r["imfFrac"] = (I["u"] - ctx["hipsY"]) / (ctx["neckY"] - ctx["hipsY"])

    x0 = -jround(o["capFit"] / step) * step
    nx = jround((uA + o["reachLat"] + 3 * o["capFit"]) / step) + 1
    tr = section_profile(P, tris, s, "y", A["u"], x0, nx, step)
    At = _profile_apex(tr, _clamp_idx(jround((uA - x0) / step), nx), o)
    if At:
        iAt = _clamp_idx(jround((At["u"] - x0) / step), nx)
        iMid = _clamp_idx(jround((0 - x0) / step), nx)
        iLat = _clamp_idx(jround((At["u"] + o["reachLat"] - x0) / step), nx)
        med = scan_cross(tr, iAt, iMid, z_wall)
        if not med:
            med = _valley_floor(tr, iMid, iAt, o)
            if med:
                flags.append("medialAtValley")
        lat = scan_cross(tr, iAt, iLat, z_wall)
        if not lat:
            lat = _end_point(tr, iLat, iAt)
            if lat:
                flags.append("lateralOpen")
        if med and lat:
            r["medial"] = [med["u"], med["z"]]
            r["lateral"] = [lat["u"], lat["z"]]
            iMed = _clamp_idx(jround((med["u"] - x0) / step), nx)
            iLt = _clamp_idx(jround((lat["u"] - x0) / step), nx)
            pt = At["z"] - max(med["z"], lat["z"])
            if pt < o["minTransverse"] * p:
                flags.append("transverseShallow")
            if _has_hole(tr, iMed, iLt, o["holeJump"]):
                flags.append("transverseHole")
            usable = pt >= o["minTransverse"] * p and "lateralOpen" not in flags and "transverseHole" not in flags
            if usable:
                r["baseWidth"] = lat["u"] - med["u"]
                r["projectionRatio"] = p / r["baseWidth"] if r["baseWidth"] > 0 else None
                tax = _cap_axis(tr, iAt, iLt, iMed, At, pt, o)
                if tax:
                    r["taxis"] = tax
                    r["divergenceDeg"] = math.atan(-tax["beta"]) * DEG
                else:
                    flags.append("noTransverseAxis")
    else:
        flags.append("noTransverseApex")

    r["ok"] = is_num(r.get("upperPoleFrac")) and is_num(r.get("tiltDeg")) and not any(f in NOT_OK for f in flags)
    return r
