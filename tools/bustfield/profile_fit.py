"""Artist profile-curve inverse fit (critique-v2 4(a)).

An art director draws the sagittal profile (side view through the apex) the
blend shape should produce, optionally plus the frontal silhouette. Because the
field is linear in the dictionary amplitudes, matching the deformed surface to
the curves is a Gauss-Newton sequence of linear least-squares problems
(point-to-curve residuals linearized at the current closest points), with a
Jacobian smoothness prior, ridge, and the same linearized det constraints as
distillation (injectivity gate at every slider extreme).

Curves are measured on the mesh, not on vertices: the selected layers (skin
+ clothes, i.e. what is visible) are cut by the plane x = x_apex in the body
frame and the front envelope max z(y) is taken (sagittal profile); the frontal
silhouette is the outermost point of each horizontal section of the torso
layers near the bust (occluding contour). Both are re-extracted from the deformed
mesh (vertices + field displacement) for the reported error, so the numbers
are what a side / front view would show.

CLI: python -m bustfield.profile_fit --help   (run from tools/ or with PYTHONPATH=tools)
"""

import argparse
import json
import sys

import numpy as np

from .distill import Dictionary, design, enforce_gate, jacobian_gram, regularizer
from .field import BustField, from_body, to_body
from .solve import solve_spd
from .validate import grid_points

# --- profile extraction ---------------------------------------------------------------


def _section_segments(B, tris, axis, value):
    """Segments where the triangle mesh (body-frame vertices B) crosses the
    plane B[:, axis] == value. Returns (M, 2, 3) endpoints."""
    s = B[:, axis] - value
    st = s[tris]  # (T, 3)
    cross = (st.min(axis=1) < 0) & (st.max(axis=1) > 0)
    tr = tris[cross]
    st = st[cross]
    segs = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        sa, sb = st[:, a], st[:, b]
        hit = (sa < 0) != (sb < 0)
        t = np.where(hit, sa / np.where(sa - sb == 0, 1, sa - sb), 0)
        p = B[tr[:, a]] + t[:, None] * (B[tr[:, b]] - B[tr[:, a]])
        segs.append((hit, p))
    # each crossing triangle has exactly two hit edges (ignoring exact zeros)
    hits = np.stack([h for h, _ in segs], axis=1)
    pts = np.stack([p for _, p in segs], axis=1)
    ok = hits.sum(axis=1) == 2
    hits, pts = hits[ok], pts[ok]
    order = np.argsort(~hits, axis=1, kind="stable")[:, :2]
    return np.take_along_axis(pts, order[:, :, None], axis=1)


def front_envelope(segs, ys, u_axis=1, h_axis=2, prefer=np.max):
    """Envelope h(u) of section segments along u (e.g. max z over y): for each
    u in `ys`, the extreme h over the segments that span it (NaN if none)."""
    a, b = segs[:, 0], segs[:, 1]
    ua, ub = a[:, u_axis], b[:, u_axis]
    lo, hi = np.minimum(ua, ub), np.maximum(ua, ub)
    out = np.full(len(ys), np.nan)
    arg = np.full(len(ys), -1)
    for i, y in enumerate(ys):
        m = (lo <= y) & (hi >= y) & (hi > lo)
        if not m.any():
            continue
        t = (y - ua[m]) / (ub[m] - ua[m])
        h = a[m, h_axis] + t * (b[m, h_axis] - a[m, h_axis])
        j = int(np.argmax(h)) if prefer is np.max else int(np.argmin(h))
        out[i] = h[j]
        arg[i] = np.nonzero(m)[0][j]
    return out, arg


class Profile:
    """Sagittal front profile of one side: points (y, z) in body-frame S units."""

    def __init__(self, x0, ys, zs):
        self.x0 = x0
        self.ys = np.asarray(ys, dtype=float)
        self.zs = np.asarray(zs, dtype=float)

    def points_body(self):
        return np.stack([np.full_like(self.ys, self.x0), self.ys, self.zs], axis=-1)


def sagittal_profile(frame, V, tris, x0, ys):
    """Front envelope z(y) of the mesh (bind-space vertices V) on the plane
    x = x0 (body frame, S units)."""
    S = frame["S"]
    B = np.asarray(to_body(frame, V)) / S
    segs = _section_segments(B, tris, 0, x0)
    z, _ = front_envelope(segs, ys, 1, 2)
    return Profile(x0, ys, z)


def frontal_silhouette(frame, V, tris, side, ys):
    """Occluding contour seen from the front: for each height y the outermost
    point (max side * x) of the horizontal section y = const (body frame, S
    units). Restrict `tris` to the torso layers near the bust (no arms) before
    calling. At such a tangent point a small surface displacement moves the
    contour by its normal component (envelope theorem), which is what makes
    tracking the rest contour points valid in the Gauss-Newton fit. Returns
    (len(ys), 3) body points (NaN rows where nothing is cut)."""
    S = frame["S"]
    B = np.asarray(to_body(frame, V)) / S
    out = np.full((len(ys), 3), np.nan)
    for i, y in enumerate(ys):
        segs = _section_segments(B, tris, 1, y)
        if not len(segs):
            continue
        pts = segs.reshape(-1, 3)
        pts = pts[side * pts[:, 0] > 0]
        if len(pts):
            out[i] = pts[np.argmax(side * pts[:, 0])]
    return out


class Curve:
    """One constraint curve in a body-frame plane.

    points: rest surface samples (N, 3), body frame, S units (NaN rows ignored)
    target: target polyline (M, 2) in the plane coordinates (u, h):
      sagittal  u = y, h = z         (side view through the apex)
      frontal   u = y, h = side * x  (front view lateral contour, outward > 0)
    """

    AXES = {"sagittal": ((1, 2), False), "frontal": ((1, 0), True)}

    def __init__(self, kind, side, points, target, weight=1.0):
        self.kind, self.side, self.weight = kind, side, weight
        self.axes, mirrored = self.AXES[kind]
        self.sign = (1, side if mirrored else 1)
        pts = np.asarray(points, dtype=float)
        self.points = pts[np.all(np.isfinite(pts), axis=1)]
        t = np.asarray(target, dtype=float)
        self.target = t[np.all(np.isfinite(t), axis=1)]

    def uh(self, B):
        B = np.asarray(B, dtype=float)
        return np.stack([B[:, a] * s for a, s in zip(self.axes, self.sign)], axis=-1)

    def error(self, B):
        """Distances (S units) from body points B to the target polyline."""
        B = np.asarray(B, dtype=float)
        B = B[np.all(np.isfinite(B), axis=1)]
        return _closest_on_polyline(self.uh(B), self.target)[2]


# --- target curves ----------------------------------------------------------------------


def rounder_target(profile, y_lower, y_upper, projection=1.1, roundness=0.15):
    """Target profile 'rounder upper pole, +X% projection'.

    Projection h(y) is measured from the chest line through the profile at
    y_lower (IMF side) and y_upper (upper boundary); the profile apex is the
    point of maximum projection. The upper pole gets extra fullness
    roundness * h_apex * sin^2(pi t), t = 0 at the apex .. 1 at y_upper (zero
    value and slope at both ends, so the apex stays the apex and the upper
    boundary stays smooth), then h is scaled by `projection` between the two
    boundary points. Outside that range the target is the rest profile.
    Returns (Profile on the same ys, info).
    """
    ys, zs = profile.ys, profile.zs
    zl = np.interp(y_lower, ys, zs)
    zu = np.interp(y_upper, ys, zs)
    base = zl + (ys - y_lower) * (zu - zl) / (y_upper - y_lower)
    h = zs - base
    inside = (ys > y_lower) & (ys < y_upper)
    ia = np.argmax(np.where(inside, h, -np.inf))
    apex_y, ha = float(ys[ia]), float(h[ia])
    ht = h.copy()
    up = inside & (ys > apex_y)
    t = (ys[up] - apex_y) / (y_upper - apex_y)
    ht[up] += roundness * ha * np.sin(np.pi * t) ** 2
    ht[inside] *= projection
    info = {"apex_y": apex_y, "h_apex": ha, "y_lower": y_lower, "y_upper": y_upper, "projection": projection, "roundness": roundness}
    return Profile(profile.x0, ys, base + ht), info


def _closest_on_polyline(pts, poly):
    """Closest points on a 2D polyline and unit normals there. pts (N, 2)."""
    a, b = poly[:-1], poly[1:]
    ab = b - a
    L2 = np.maximum((ab**2).sum(-1), 1e-300)
    t = np.clip(((pts[:, None, :] - a[None]) * ab[None]).sum(-1) / L2[None], 0, 1)
    c = a[None] + t[..., None] * ab[None]
    d2 = ((pts[:, None, :] - c) ** 2).sum(-1)
    j = np.argmin(d2, axis=1)
    cp = c[np.arange(len(pts)), j]
    tang = ab[j] / np.sqrt(L2[j])[:, None]
    nrm = np.stack([-tang[:, 1], tang[:, 0]], axis=-1)
    return cp, nrm, np.sqrt(d2[np.arange(len(pts)), j])


def profile_error(prof, target):
    """Distances from profile points (y, z) to the target polyline (S units)."""
    ok = np.isfinite(prof.zs)
    pts = np.stack([prof.ys[ok], prof.zs[ok]], axis=-1)
    poly = np.stack([target.ys, target.zs], axis=-1)
    poly = poly[np.isfinite(poly[:, 1])]
    _, _, d = _closest_on_polyline(pts, poly)
    return d


# --- fit -----------------------------------------------------------------------------------


def fit_profile(
    frame,
    base_params,
    target_name,
    curves,
    dic=None,
    smooth=1e-3,
    ridge=1e-6,
    keep=None,
    keep_weight=1e-3,
    iters=8,
    gate=0.2,
    tau=0.26,
    gate_res=(14, 20),
    verbose=False,
):
    """Fit amplitudes of `target_name` so the deformed surface matches `curves`.

    curves: list of Curve (sagittal and/or frontal, one per side; the student
    is mirror symmetric, so both sides constrain the same amplitudes).
    smooth: weight of the Jacobian smoothness prior sum_g ||J_g c||^2 over the
    fieldCheck grid, relative to the data term (keeps the edit broad and
    rounded instead of a ridge along the profile line).
    keep: optional (P, U) bind-space samples whose displacement should stay
    close to U (e.g. a prior shape); weight keep_weight relative to the curves.
    Returns (params, coef, info).
    """
    S = frame["S"]
    field = BustField(frame, base_params)
    dic = Dictionary.lattice() if dic is None else dic
    K = dic.K
    axes = [np.asarray(frame[k]) for k in ("left", "up", "forward")]
    blocks = []
    for cv in curves:
        P = np.asarray(from_body(frame, cv.points * S))
        A = design(field, dic, P)  # (N, 3, K) bind-space displacement per amplitude
        # displacement of the curve coordinates (u, h) per amplitude, S units
        Au = np.einsum("i,nik->nk", axes[cv.axes[0]], A) * (cv.sign[0] / S)
        Ah = np.einsum("i,nik->nk", axes[cv.axes[1]], A) * (cv.sign[1] / S)
        blocks.append((cv, cv.uh(cv.points), Au, Ah, cv.weight / np.sqrt(len(cv.points))))

    G = jacobian_gram(field, dic, grid_points(field, 14)[0])
    Hk = np.zeros((K, K))
    gk = np.zeros(K)
    if keep is not None:
        Pk, Uk = keep
        Ak = design(field, dic, Pk).reshape(-1, K) / S
        Hk = Ak.T @ Ak / len(Pk)
        gk = Ak.T @ (np.asarray(Uk).reshape(-1) / S) / len(Pk)

    c = np.zeros(K)
    hist = []
    for it in range(iters):
        rows, rhs = [], []
        for cv, uh0, Au, Ah, w in blocks:
            uh = uh0 + np.stack([Au @ c, Ah @ c], axis=-1)
            cp, n, _ = _closest_on_polyline(uh, cv.target)
            # point-to-curve residual  n . (uh0 + [Au; Ah] c - cp), n frozen
            rows.append(w * (n[:, :1] * Au + n[:, 1:] * Ah))
            rhs.append(w * (n * (cp - uh0)).sum(-1))
        R = np.concatenate(rows)
        r = np.concatenate(rhs)
        H = R.T @ R
        g = R.T @ r
        tr = max(np.trace(H), 1e-300)
        H = H + regularizer(H, ridge) + smooth * tr / max(np.trace(G), 1e-300) * G
        if keep is not None:
            kw = keep_weight * tr / max(np.trace(Hk), 1e-300)
            H = H + kw * Hk
            g = g + kw * gk
        c_new = solve_spd(H, g)
        step = float(np.abs(c_new - c).max())
        c = c_new
        res = np.concatenate([np.abs(rw @ c - rr) / b[4] for b, rw, rr in zip(blocks, rows, rhs)])
        hist.append({"iter": it, "rms": float(np.sqrt(np.mean(res**2))), "step": step})
        if verbose:
            print(f"  gn {it}: curve rms {hist[-1]['rms']:.5f} S, step {step:.2e}", file=sys.stderr)
        if step < 1e-7:
            break
    coef, params, qp, worst, fixed = enforce_gate(frame, base_params, dic, [target_name], H, {target_name: g}, {target_name: c}, gate, tau, gate_res, verbose=verbose)
    info = {"gauss_newton": hist, "qp": qp, "minDet": min(worst, fixed), "minDet_movable": worst, "minDet_fixed_targets_only": fixed}
    return params, coef[target_name], info


# --- CLI -------------------------------------------------------------------------------------


def deformed_vertices(field, target, V, weight=1.0):
    out = V.copy()
    m = field.weight(V) > 0
    out[m] += weight * field.delta(target, V[m])
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m bustfield.profile_fit", description=__doc__.split("\n\n")[0])
    ap.add_argument("--bind", required=True)
    ap.add_argument("--params", help="base params (default: the bind export's params)")
    ap.add_argument("--target", default="bust_size_up_stylized", help="target (blend shape) to fit")
    ap.add_argument("--layers", default="UP_Skin,UP*", help="material patterns of the visible layers")
    ap.add_argument("--curve", help="JSON {ys: [...], zs: [...]} target sagittal profile, apex-relative S units "
                    "(same for both sides); default: rounder upper pole + 10%% projection of the rest profile")
    ap.add_argument("--frontal", help="optional JSON {ys: [...], xs: [...]} target frontal silhouette (lateral "
                    "contour, x outward), apex-relative S units")
    ap.add_argument("--frontal-weight", type=float, default=1.0)
    ap.add_argument("--projection", type=float, default=1.1)
    ap.add_argument("--roundness", type=float, default=0.15)
    ap.add_argument("--y-lower", type=float, default=-0.26, help="chest-line point below the apex (S, apex-relative)")
    ap.add_argument("--y-upper", type=float, default=0.3, help="chest-line point above the apex (S, apex-relative)")
    ap.add_argument("--smooth", type=float, default=1e-3)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    from .bind import Bind
    from .distill import json_safe
    from .schema import validate as validate_schema

    bind = Bind.load(a.bind)
    frame = bind.frame
    base = json.load(open(a.params)) if a.params else bind.params
    validate_schema(base)
    rep = run(frame, base, bind, a)
    params = rep.pop("params")
    validate_schema(params)
    with open(a.out, "w") as f:
        json.dump(params, f, indent=1)
    if a.report:
        with open(a.report, "w") as f:
            json.dump(json_safe(rep), f, indent=1)
    e = rep["error"]
    rel = f" ({100 * e['after_rms_rel']:.1f}% of apex projection)" if e["after_rms_rel"] is not None else ""
    print(
        f"profile fit {a.target}: rest->target rms {e['before_rms']:.4f} S, fitted rms {e['after_rms']:.4f} S{rel}, "
        f"max {e['after_max']:.4f} S, minDet {rep['gate']['minDet']:.3f} (combos with {a.target}: {rep['gate']['minDet_movable']:.3f})"
    )
    if "frontal" in e:
        f = e["frontal"]
        print(f"  frontal silhouette: rest->target rms {f['before_rms']:.4f} S, fitted rms {f['after_rms']:.4f} S, max {f['after_max']:.4f} S")
    return 0


def _mesh(bind, layers):
    """Concatenated vertices, triangles of the layers, skin-weight mask."""
    V, tris, mask = [], [], []
    off = 0
    for m in bind.meshes:
        if m.groups:
            t = m.group_triangles(layers)
        else:
            idx = m.index if m.index is not None else np.arange(m.vertex_count)
            t = np.asarray(idx, dtype=np.int64).reshape(-1, 3)
        V.append(m.positions)
        mask.append(m.mask if m.mask is not None else np.ones(m.vertex_count))
        tris.append(t + off)
        off += m.vertex_count
    return np.concatenate(V), np.concatenate(tris), np.concatenate(mask)


def run(frame, base, bind, a):
    """Build the curves, fit, re-measure on the deformed mesh (CLI + tests)."""
    S = frame["S"]
    field = BustField(frame, base)
    V, tris, mask = _mesh(bind, a.layers.split(","))
    # frontal contour: torso layers only (arm-weighted triangles excluded via
    # the skin-weight mask) and only inside the window
    w = field.weight(V)
    torso = tris[(mask[tris] > 0.5).all(axis=1) & (w[tris] > 0).all(axis=1)]
    apexes = [np.asarray(to_body(frame, s.apex)) / S for s in field.sides]
    ys_rel = np.arange(a.y_lower - 0.08, a.y_upper + 0.08 + 1e-9, 0.01)
    frontal = getattr(a, "frontal", None)
    curves, meta, measure = [], [], []
    for apex, side in zip(apexes, (1, -1)):
        rest = sagittal_profile(frame, V, tris, apex[0], apex[1] + ys_rel)
        rel = Profile(apex[0], ys_rel, rest.zs - apex[2])
        ok = np.isfinite(rel.zs)
        if a.curve:
            c = json.load(open(a.curve))
            tg_rel, info = Profile(apex[0], np.asarray(c["ys"], float), np.asarray(c["zs"], float)), {}
        else:
            tg_rel, info = rounder_target(Profile(apex[0], rel.ys[ok], rel.zs[ok]), a.y_lower, a.y_upper, a.projection, a.roundness)
        cv = Curve("sagittal", side, rest.points_body(), np.stack([tg_rel.ys + apex[1], tg_rel.zs + apex[2]], axis=-1))
        curves.append(cv)
        measure.append((cv, lambda Vd, x0=apex[0], ys=rest.ys: sagittal_profile(frame, Vd, tris, x0, ys).points_body()))
        meta.append({"apex": apex.tolist(), **info, "rest_rel": {"ys": rel.ys.tolist(), "zs": rel.zs.tolist()}, "target_rel": {"ys": tg_rel.ys.tolist(), "zs": tg_rel.zs.tolist()}})
        if frontal:
            fr = json.load(open(frontal))
            # sample the contour only where the artist drew it
            fy = np.asarray(fr["ys"], float)
            ys_f = apex[1] + ys_rel[(ys_rel >= fy.min()) & (ys_rel <= fy.max())]
            pts = frontal_silhouette(frame, V, torso, side, ys_f)
            tgt = np.stack([np.asarray(fr["ys"], float) + apex[1], np.asarray(fr["xs"], float) + side * apex[0]], axis=-1)
            cf = Curve("frontal", side, pts, tgt, getattr(a, "frontal_weight", 1.0))
            curves.append(cf)
            measure.append((cf, lambda Vd, s=side, ys=ys_f: frontal_silhouette(frame, Vd, torso, s, ys)))
            meta[-1]["frontal_rest_rel"] = {"ys": (pts[:, 1] - apex[1]).tolist(), "xs": (side * (pts[:, 0] - apex[0])).tolist()}
    params, coef, info = fit_profile(frame, base, a.target, curves, smooth=a.smooth, verbose=a.verbose)
    Vd = deformed_vertices(BustField(frame, params), a.target, V)
    errs = {"sagittal": ([], []), "frontal": ([], [])}
    deformed = []
    for cv, fn in measure:
        d = fn(Vd)
        errs[cv.kind][0].append(cv.error(cv.points))
        errs[cv.kind][1].append(cv.error(d))
        if cv.kind == "sagittal":
            deformed.append(d)
    h_apex = float(np.mean([m.get("h_apex", np.nan) for m in meta]))

    def stats(kind):
        eb, ea = np.concatenate(errs[kind][0]), np.concatenate(errs[kind][1])
        return {"before_rms": float(np.sqrt(np.mean(eb**2))), "after_rms": float(np.sqrt(np.mean(ea**2))), "after_max": float(ea.max())}

    error = {**stats("sagittal"), "units": "S", "h_apex": h_apex}
    error["after_rms_rel"] = error["after_rms"] / h_apex if np.isfinite(h_apex) else None
    if errs["frontal"][0]:
        error["frontal"] = stats("frontal")
    for m, d in zip(meta, deformed):
        m["deformed_rel"] = {"ys": (d[:, 1] - m["apex"][1]).tolist(), "zs": (d[:, 2] - m["apex"][2]).tolist()}
    return {
        "params": params,
        "target": a.target,
        "error": error,
        "gate": {
            "threshold": 0.2,
            "res": [14, 20],
            "minDet": info["minDet"],
            "minDet_movable": info["minDet_movable"],
            "minDet_fixed_targets_only": info["minDet_fixed_targets_only"],
        },
        "fit": info,
        "atoms_per_side": len(params["targets"][a.target]),
        "sides": meta,
    }


if __name__ == "__main__":
    sys.exit(main())
