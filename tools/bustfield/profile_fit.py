"""Artist profile-curve inverse fit (critique-v2 4(a)).

An art director draws the sagittal profile (side view through the apex) the
blend shape should produce, optionally plus the frontal silhouette. Because the
field is linear in the dictionary amplitudes, matching the deformed surface to
the curves is a Gauss-Newton sequence of linear least-squares problems
(point-to-curve residuals linearized at the current closest points), with a
Jacobian smoothness prior, ridge, and the same linearized det constraints as
distillation (injectivity gate at every slider extreme).

Profiles are measured on the mesh, not on vertices: the selected layers (skin
+ clothes, i.e. what is visible) are cut by the plane x = x_apex in the body
frame and the front envelope max z(y) is taken. The deformed profile is
re-extracted from the deformed mesh (vertices + field displacement) for the
reported error, so the number is what a side view would show.

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
    """Fit amplitudes of `target_name` so the deformed profiles match `curves`.

    curves: list of (rest Profile, target Profile) pairs, one per side (the
    student is mirror symmetric, so both sides constrain the same amplitudes).
    smooth: weight of the Jacobian smoothness prior sum_g ||J_g c||^2 over the
    fieldCheck grid, relative to the data term (keeps the edit broad and
    rounded instead of a ridge along the profile line).
    keep: optional (P, U) skin samples whose displacement should stay close to
    U (e.g. a prior shape); weight keep_weight relative to the profile term.
    Returns (params, coef, info).
    """
    S = frame["S"]
    field = BustField(frame, base_params)
    dic = Dictionary.lattice() if dic is None else dic
    K = dic.K
    # Profile sample points in bind space and their design rows.
    Pb = np.concatenate([rest.points_body()[np.isfinite(rest.zs)] for rest, _ in curves])
    side_of = np.concatenate([np.full(int(np.isfinite(rest.zs).sum()), i) for i, (rest, _) in enumerate(curves)])
    P = np.asarray(from_body(frame, Pb * S))
    A = design(field, dic, P)  # (N, 3, K) bind-space displacement per amplitude
    up, fw = np.asarray(frame["up"]), np.asarray(frame["forward"])
    Ay = np.einsum("i,nik->nk", up, A) / S  # body-y displacement in S units
    Az = np.einsum("i,nik->nk", fw, A) / S
    polys = [np.stack([tg.ys, tg.zs], axis=-1) for _, tg in curves]
    polys = [p[np.isfinite(p[:, 1])] for p in polys]

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
        yz = np.stack([Pb[:, 1] + Ay @ c, Pb[:, 2] + Az @ c], axis=-1)
        rows, rhs = [], []
        for i, poly in enumerate(polys):
            m = side_of == i
            cp, n, d = _closest_on_polyline(yz[m], poly)
            # n . (yz0 + [Ay; Az] c - cp) = 0
            rows.append(n[:, :1] * Ay[m] + n[:, 1:] * Az[m])
            rhs.append((n * (cp - np.stack([Pb[m, 1], Pb[m, 2]], axis=-1))).sum(-1))
        R = np.concatenate(rows) / np.sqrt(len(Pb))
        r = np.concatenate(rhs) / np.sqrt(len(Pb))
        H = R.T @ R
        g = R.T @ r
        tr = max(np.trace(H), 1e-300)
        H = H + regularizer(H, ridge) + smooth * tr / max(np.trace(G), 1e-300) * G
        if keep is not None:
            H = H + keep_weight * tr / max(np.trace(Hk), 1e-300) * Hk
            g = g + keep_weight * tr / max(np.trace(Hk), 1e-300) * gk
        c_new = solve_spd(H, g)
        step = float(np.abs(c_new - c).max())
        c = c_new
        res = np.abs(R @ c - r) * np.sqrt(len(Pb))
        hist.append({"iter": it, "rms": float(np.sqrt(np.mean(res**2))), "step": step})
        if verbose:
            print(f"  gn {it}: profile rms {hist[-1]['rms']:.5f} S, step {step:.2e}", file=sys.stderr)
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
    return 0


def run(frame, base, bind, a):
    """Fit + report (shared by the CLI and the tests)."""
    S = frame["S"]
    field = BustField(frame, base)
    V, tris = [], []
    off = 0
    for m in bind.meshes:
        t = m.group_triangles(a.layers.split(","))
        V.append(m.positions)
        tris.append(t + off)
        off += m.vertex_count
    V = np.concatenate(V)
    tris = np.concatenate(tris)
    apexes = [np.asarray(to_body(frame, s.apex)) / S for s in field.sides]
    ys_rel = np.arange(a.y_lower - 0.08, a.y_upper + 0.08 + 1e-9, 0.01)
    curves, meta = [], []
    for apex in apexes:
        rest = sagittal_profile(frame, V, tris, apex[0], apex[1] + ys_rel)
        rel = Profile(apex[0], ys_rel, rest.zs - apex[2])
        if a.curve:
            c = json.load(open(a.curve))
            tg_rel = Profile(apex[0], np.asarray(c["ys"], float), np.asarray(c["zs"], float))
            info = {}
        else:
            ok = np.isfinite(rel.zs)
            relc = Profile(apex[0], rel.ys[ok], rel.zs[ok])
            tg_rel, info = rounder_target(relc, a.y_lower, a.y_upper, a.projection, a.roundness)
        tg = Profile(apex[0], tg_rel.ys + apex[1], tg_rel.zs + apex[2])
        rest_ok = Profile(apex[0], rest.ys[np.isfinite(rest.zs)], rest.zs[np.isfinite(rest.zs)])
        curves.append((rest_ok, tg))
        meta.append({"apex": apex.tolist(), **info, "rest_rel": {"ys": rel.ys.tolist(), "zs": rel.zs.tolist()}, "target_rel": {"ys": tg_rel.ys.tolist(), "zs": tg_rel.zs.tolist()}})
    params, coef, info = fit_profile(frame, base, a.target, curves, smooth=a.smooth, verbose=a.verbose)
    fs = BustField(frame, params)
    Vd = deformed_vertices(fs, a.target, V)
    errs_before, errs_after, deformed = [], [], []
    for (rest, tg), apex in zip(curves, apexes):
        errs_before.append(profile_error(rest, tg))
        prof = sagittal_profile(frame, Vd, tris, apex[0], rest.ys)
        errs_after.append(profile_error(prof, tg))
        deformed.append({"ys": (prof.ys - apex[1]).tolist(), "zs": (prof.zs - apex[2]).tolist()})
    eb, ea = np.concatenate(errs_before), np.concatenate(errs_after)
    h_apex = np.mean([m.get("h_apex", np.nan) for m in meta])
    for m, d in zip(meta, deformed):
        m["deformed_rel"] = d
    return {
        "params": params,
        "target": a.target,
        "error": {
            "before_rms": float(np.sqrt(np.mean(eb**2))),
            "after_rms": float(np.sqrt(np.mean(ea**2))),
            "after_max": float(ea.max()),
            "after_rms_rel": float(np.sqrt(np.mean(ea**2)) / h_apex) if np.isfinite(h_apex) else None,
            "h_apex": float(h_apex),
            "units": "S",
        },
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
