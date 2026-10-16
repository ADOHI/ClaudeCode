"""Distill teacher displacements into the bind-space field (Kelvinlet dictionary).

Teachers (FEM, dARAP, artist curves, or the hand-tuned field itself) give
displacements U at bind positions P. The student is the field of field.js with
a fixed dictionary of Kelvinlet atoms: centres on a multi-level lattice around
the apex (side frame, mirrored to both sides by construction), grab atoms with
3 amplitude dofs (d) and scale atoms with 1 dof (k), nu fixed per family.

Window, midline share and lateral lock are applied after the brush sum, so the
student is LINEAR in the amplitudes: one design matrix A (assembled through
BustField.assemble, i.e. exactly the JS linear map) and a ridge least squares
solve. The injectivity gate (det(I + sum w J) over the fieldCheck grid at all
slider extremes) is then enforced with linearized det constraints (a small QP),
falling back to stronger ridge / Jacobian smoothing if that does not converge.

Samples come from three sources (decision-v2 3(a)):
  skin      mesh vertices of body + clothes
  interior  points under the skin (teacher volume or offset along -normal)
  shell     1-3 cm outside the skin with the teacher displacement extrapolated
            (constant) along the normal, so the space where clothes sit is
            controlled even when the teacher only knows the skin.

CLI: python -m bustfield.distill --help   (run from tools/ or with PYTHONPATH=tools)
"""

import argparse
import json
import sys
import time

import numpy as np

from . import kelvinlet as kv
from .field import BustField, TARGETS, clone_params, params_with_targets, slider_to_weights
from .solve import det_rows, solve_qp, solve_spd
from .validate import combo_dets, extreme_combos, grid_points

KIND_SKIN, KIND_INTERIOR, KIND_SHELL = 0, 1, 2

# Default lattice (apex-relative side frame, S units). Three radius levels; the
# coarse level carries the bulk shape, finer levels the profile detail. Centres
# sit inside the mound / chest (z <= 0) so the field is smooth on the skin.
DEFAULT_LEVELS = (
    {"radius": 0.22, "x": (-0.08, 0.08, 2), "y": (-0.1, 0.1, 3), "z": (-0.14, -0.04, 2), "types": ("grab", "scale")},
    {"radius": 0.15, "x": (-0.12, 0.12, 3), "y": (-0.16, 0.16, 3), "z": (-0.12, -0.12, 1), "types": ("grab", "scale")},
    {"radius": 0.1, "x": (-0.08, 0.08, 2), "y": (-0.12, 0.12, 3), "z": (-0.06, -0.06, 1), "types": ("grab",)},
)


# --- dictionary ---------------------------------------------------------------------


class Dictionary:
    """Fixed-centre Kelvinlet atoms in the apex-relative side frame (S units)."""

    def __init__(self, atoms, nu_grab=0.45, nu_scale=0.2):
        self.atoms = [dict(a) for a in atoms]
        self.nu = {"grab": nu_grab, "scale": nu_scale}
        self.slices = []
        k = 0
        for a in self.atoms:
            n = 3 if a["type"] == "grab" else 1
            self.slices.append(slice(k, k + n))
            k += n
        self.K = k

    def __len__(self):
        return len(self.atoms)

    @classmethod
    def lattice(cls, levels=DEFAULT_LEVELS, nu_grab=0.45, nu_scale=0.2):
        atoms = []
        for lv in levels:
            axes = [np.linspace(*lv[c]) if lv[c][2] > 1 else np.array([lv[c][0]]) for c in "xyz"]
            for x in axes[0]:
                for y in axes[1]:
                    for z in axes[2]:
                        for t in lv["types"]:
                            atoms.append({"type": t, "at": [round(float(x), 6), round(float(y), 6), round(float(z), 6)], "radius": lv["radius"]})
        return cls(atoms, nu_grab, nu_scale)

    def subset(self, keep):
        return Dictionary([self.atoms[i] for i in keep], self.nu["grab"], self.nu["scale"])

    def side_columns(self, field):
        """Q (M, 3) side frame (absolute, base-relative) -> (M, 3, K) columns.

        Column units: grab dof = d in S units (so the column is S * G), scale
        dof = k (dimensionless). Fitted amplitudes are therefore directly the
        `d` / `k` values of the params JSON.
        """
        S, depth, physical = field.S, field.depth, field.physical
        res = []
        for a in self.atoms:
            at = [a["at"][0] * S, a["at"][1] * S, a["at"][2] * S + depth]
            eps = a["radius"] * S
            res.append((a["type"], np.array(at), eps, self.nu[a["type"]]))

        def cols(Q):
            out = np.zeros(Q.shape[:-1] + (3, self.K))
            for (typ, at, eps, nu), sl in zip(res, self.slices):
                r = Q - at
                if typ == "grab":
                    G = kv.grab_basis(r, eps, nu) if physical else kv.grab_smooth_basis(r, eps)
                    out[..., :, sl] = G * S
                else:
                    v = kv.scale_basis(r, eps, nu) if physical else kv.scale_smooth_basis(r, eps)
                    out[..., :, sl] = v[..., :, None]
            return out

        return cols

    def to_ops(self, coef, digits=8, drop=0.0):
        """Amplitudes -> field.js ops (atoms with |amplitude| <= drop are omitted)."""
        ops = []
        for a, sl in zip(self.atoms, self.slices):
            c = coef[sl]
            if np.abs(c).max() <= drop:
                continue
            op = {"type": a["type"], "at": list(a["at"])}
            if a["type"] == "grab":
                op["d"] = [round(float(v), digits) for v in c]
            else:
                op["k"] = round(float(c[0]), digits)
            op["radius"] = a["radius"]
            op["nu"] = self.nu[a["type"]]
            ops.append(op)
        return ops

    def from_ops(self, ops):
        """Coefficient vector for ops that use this dictionary's atoms."""
        c = np.zeros(self.K)
        index = {(a["type"], tuple(a["at"]), a["radius"]): sl for a, sl in zip(self.atoms, self.slices)}
        for op in ops:
            sl = index[(op["type"], tuple(op["at"]), op["radius"])]
            c[sl] = op["d"] if op["type"] == "grab" else [op["k"]]
        return c


# --- samples ------------------------------------------------------------------------


class Samples:
    """Teacher samples for one target set: positions P (N, 3), displacements
    U {target: (N, 3)}, weights w (N,), kind (N,) (skin / interior / shell)."""

    def __init__(self, P, U, w, kind):
        self.P = np.asarray(P, dtype=float)
        self.U = {t: np.asarray(u, dtype=float) for t, u in U.items()}
        self.w = np.asarray(w, dtype=float)
        self.kind = np.asarray(kind, dtype=int)

    def __len__(self):
        return self.P.shape[0]

    def subset(self, m):
        return Samples(self.P[m], {t: u[m] for t, u in self.U.items()}, self.w[m], self.kind[m])

    @classmethod
    def concat(cls, parts):
        parts = [p for p in parts if len(p)]
        T = parts[0].U.keys()
        return cls(
            np.concatenate([p.P for p in parts]),
            {t: np.concatenate([p.U[t] for p in parts]) for t in T},
            np.concatenate([p.w for p in parts]),
            np.concatenate([p.kind for p in parts]),
        )

    def save(self, path):
        np.savez_compressed(path, P=self.P, w=self.w, kind=self.kind, **{f"U_{t}": u for t, u in self.U.items()})

    @classmethod
    def load(cls, path):
        z = np.load(path)
        if "format" in z.files and str(z["format"]) == "bust-teacher/1":
            # tools/teacher output: one target per file, displacement under 'U'
            # (bind space). 'U_body' is the same data in body/S units, not a target.
            U = {str(z["target"]): z["U"]}
        else:
            U = {k[2:]: z[k] for k in z.files if k.startswith("U_")}
        w = z["w"] if "w" in z.files else np.ones(len(z["P"]))
        kind = z["kind"] if "kind" in z.files else np.zeros(len(z["P"]), int)
        return cls(z["P"], U, w, kind)


def make_samples(
    field,
    P_skin,
    N_skin,
    targets,
    teacher=None,
    U_skin=None,
    shell_offsets=(0.005, 0.01, 0.015),
    interior_depths=(0.03, 0.06, 0.1),
    weights=(1.0, 0.5, 0.5),
):
    """Build skin + interior + shell samples inside the student's support.

    teacher(name, P) -> (N, 3) evaluates the teacher anywhere (analytic / field
    teachers); without it, U_skin {name: (N, 3)} must be given and interior
    samples are skipped (an FEM teacher passes its own interior nodes through
    Samples.concat instead). Shell samples always use the skin displacement
    extrapolated (constant) along the normal, as a surface teacher would.
    Offsets / depths are in S units.
    """
    S = field.S
    P_skin = np.asarray(P_skin, dtype=float)
    N = np.asarray(N_skin, dtype=float)
    nl = np.linalg.norm(N, axis=1)
    N = N / np.where(nl > 0, nl, 1)[:, None]
    inside = field.weight(P_skin) > 0
    P_skin, N = P_skin[inside], N[inside]
    if U_skin is None:
        U_skin = {t: teacher(t, P_skin) for t in targets}
    else:
        U_skin = {t: np.asarray(U_skin[t], dtype=float)[inside] for t in targets}
    parts = [Samples(P_skin, U_skin, np.full(len(P_skin), weights[0]), np.full(len(P_skin), KIND_SKIN))]
    if teacher is not None:
        for dpt in interior_depths:
            Pi = P_skin - N * (dpt * S)
            m = field.weight(Pi) > 0
            Pi = Pi[m]
            parts.append(Samples(Pi, {t: teacher(t, Pi) for t in targets}, np.full(len(Pi), weights[1] / len(interior_depths)), np.full(len(Pi), KIND_INTERIOR)))
    for off in shell_offsets:
        Ps = P_skin + N * (off * S)
        m = field.weight(Ps) > 0
        parts.append(
            Samples(Ps[m], {t: U_skin[t][m] for t in targets}, np.full(int(m.sum()), weights[2] / len(shell_offsets)), np.full(int(m.sum()), KIND_SHELL))
        )
    return Samples.concat(parts)


# --- linear system --------------------------------------------------------------------


def design(field, dic, P):
    """(N, 3, K) bind-space columns: delta(P) = design @ amplitudes."""
    return field.assemble(P, dic.side_columns(field), dic.K)


def jacobian_columns(field, dic, P):
    """(N, 9, K) d(design)/dp by the same central differences as field.jacobian."""
    P = np.asarray(P, dtype=float)
    cols = dic.side_columns(field)
    h = field.h
    J = np.empty(P.shape[:-1] + (3, 3, dic.K))
    for j in range(3):
        pp = P.copy()
        pm = P.copy()
        pp[..., j] += h
        pm[..., j] -= h
        J[..., :, j, :] = (field.assemble(pp, cols, dic.K) - field.assemble(pm, cols, dic.K)) / (2 * h)
    return J.reshape(P.shape[:-1] + (9, dic.K))


def normal_equations(field, dic, samples, targets, chunk=2048):
    """A'WA (K, K), A'W u_t (K,) and u_t'W u_t, accumulated in chunks."""
    K = dic.K
    AtA = np.zeros((K, K))
    Atb = {t: np.zeros(K) for t in targets}
    btb = {t: 0.0 for t in targets}
    for s in range(0, len(samples), chunk):
        e = slice(s, s + chunk)
        A = design(field, dic, samples.P[e])  # (n, 3, K)
        w = samples.w[e]
        Aw = A * np.sqrt(w)[:, None, None]
        Af = Aw.reshape(-1, K)
        AtA += Af.T @ Af
        for t in targets:
            b = (samples.U[t][e] * np.sqrt(w)[:, None]).reshape(-1)
            Atb[t] += Af.T @ b
            btb[t] += float(b @ b)
    return AtA, Atb, btb


def jacobian_gram(field, dic, P, chunk=1024):
    """sum_g ||J_g c||^2 = c' G c over grid points P (smoothness / det prior)."""
    G = np.zeros((dic.K, dic.K))
    for s in range(0, len(P), chunk):
        Jc = jacobian_columns(field, dic, P[s : s + chunk]).reshape(-1, dic.K)
        G += Jc.T @ Jc
    return G


def regularizer(AtA, ridge, G=None, jac=0.0):
    """Column-scaled ridge (scale invariant) + optional Jacobian smoothing."""
    D = np.diag(AtA).copy()
    floor = 1e-6 * max(float(D.mean()), 1e-300)
    R = ridge * np.diag(np.maximum(D, floor))
    if G is not None and jac > 0:
        R = R + jac * (np.trace(AtA) / max(np.trace(G), 1e-300)) * G
    return R


# --- evaluation ---------------------------------------------------------------------


def rms_stats(field, samples, targets, kinds=(KIND_SKIN,)):
    """Per target: RMS error / max teacher displacement on the given sample kinds."""
    m = np.isin(samples.kind, kinds)
    P = samples.P[m]
    out = {}
    for t in targets:
        U = samples.U[t][m]
        V = field.delta(t, P)
        err = np.linalg.norm(V - U, axis=1)
        umax = float(np.linalg.norm(U, axis=1).max()) if len(U) else 0.0
        rms = float(np.sqrt(np.mean(err**2))) if len(U) else 0.0
        out[t] = {
            "rms": rms / field.S,
            "max_err": float(err.max()) / field.S if len(U) else 0.0,
            "max_disp": umax / field.S,
            "rel_rms": rms / umax if umax > 0 else 0.0,
            "n": int(m.sum()),
        }
    return out


def gate_check(frame, params, res=(14,), combos=None):
    """min det over the fieldCheck grids; returns (min_det, per-res dict)."""
    from .validate import field_check

    f = BustField(frame, params)
    per = {}
    for r in res:
        c = field_check(f, r, combos)
        per[r] = {"minDet": c["minDet"], "minCombo": c["minCombo"], "samples": c["samples"]}
    return min(v["minDet"] for v in per.values()), per


# --- fitting --------------------------------------------------------------------------


class DistillResult:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def report(self):
        return json_safe({k: v for k, v in self.__dict__.items() if k not in ("params", "coef", "dictionary")})


def json_safe(o):
    """Strict-JSON copy (inf / nan -> None, numpy -> python)."""
    if isinstance(o, dict):
        return {str(k): json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [json_safe(v) for v in o]
    if isinstance(o, np.ndarray):
        return json_safe(o.tolist())
    if isinstance(o, (np.floating, float)):
        return float(o) if np.isfinite(o) else None
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


class GateGrid:
    """The fieldCheck grids (res 14, 20, ...) with the dictionary's Jacobian
    columns cached. The student is linear in its amplitudes, so the Jacobian
    of a variable target is Jc @ c and screening every slider extreme is a
    matrix product, not a field evaluation. (Cached in float32: this is only
    the screen; results are re-checked with the real field afterwards.)
    """

    def __init__(self, frame, base_params, dic, var_targets, res=(14, 20)):
        field = BustField(frame, base_params)
        self.P = np.concatenate([grid_points(field, r)[0] for r in res])
        self.var = list(var_targets)
        self.targets = list(dict.fromkeys(field.targets + self.var))
        self.Jc = np.concatenate([jacobian_columns(field, dic, self.P[s : s + 1024]).astype(np.float32) for s in range(0, len(self.P), 1024)])
        self.fixed = {t: field.jacobian(t, self.P) for t in field.targets if t not in self.var}
        self.combos = extreme_combos()
        self.movable = np.array([any(slider_to_weights(**c).get(t, 0) for t in self.var) for c in self.combos])

    def jacobians(self, coef, idx=slice(None)):
        J = {t: v[idx] for t, v in self.fixed.items()}
        for t in self.var:
            J[t] = np.einsum("nik,k->ni", self.Jc[idx], coef[t]).reshape(-1, 3, 3)
        return J

    def screen(self, coef, tau=None, cap=0):
        """(min det of movable combos, of fixed-only combos, worst pairs below tau)."""
        D = combo_dets(self.jacobians(coef), self.targets, self.combos)
        worst = float(D[self.movable].min()) if self.movable.any() else np.inf
        fixed = float(D[~self.movable].min()) if (~self.movable).any() else np.inf
        pairs = []
        if cap > 0:
            Dm = np.where(self.movable[:, None], D, np.inf)
            ci, pi = np.nonzero(Dm < tau)
            order = np.argsort(Dm[ci, pi])[:cap]
            pairs = [(int(pi[o]), int(ci[o])) for o in order]
        return worst, fixed, pairs


def enforce_gate(frame, base_params, dic, targets, H, g, coef, gate=0.2, tau=0.26, res=(14, 20), max_iter=8, cap=128, digits=8, verbose=False, grid=None):
    """Linearized injectivity constraints (SQP on the det).

    Objective per target: 1/2 c'H_t c - g_t'c (H a matrix shared by all
    targets or a dict). While some slider extreme has det(I + sum w J) <= gate
    on the fieldCheck grids, add the worst (point, combo) pairs as constraints
    det(F0) + <cof(F0), dF> >= tau (tau > gate absorbs the cubic's curvature),
    re-linearize all of them at the new solution and solve the joint QP again.
    Returns (coef, params, history, min det of movable combos, of fixed ones).
    """
    K = dic.K
    grid = GateGrid(frame, base_params, dic, targets, res) if grid is None else grid
    Ht = H if isinstance(H, dict) else {t: H for t in targets}
    worst, fixed, _ = grid.screen(coef)
    history = [{"qp_iter": 0, "constraints": 0, "minDet": min(worst, fixed)}]
    Hb = np.zeros((K * len(targets),) * 2)
    gb = np.zeros(K * len(targets))
    for i, t in enumerate(targets):
        Hb[i * K : (i + 1) * K, i * K : (i + 1) * K] = Ht[t]
        gb[i * K : (i + 1) * K] = g[t]
    work = {}  # (point index, combo index) -> order added
    for it in range(1, max_iter + 1):
        if worst > gate:
            break
        for pc in grid.screen(coef, tau, cap)[2]:
            work.setdefault(pc, len(work))
        pairs = list(work)
        idx = np.array([p for p, _ in pairs])
        J0s = grid.jacobians(coef, idx)
        rows, det0 = det_rows(J0s, grid.Jc[idx].astype(float), grid.targets, targets, grid.combos, [(i, c) for i, (_, c) in enumerate(pairs)])
        x0 = np.concatenate([coef[t] for t in targets])
        x, lam = solve_qp(Hb, gb, rows, tau - det0 + rows @ x0)
        if not np.all(np.isfinite(x)):
            history.append({"qp_iter": it, "error": "non-finite QP solution"})
            break
        coef = {t: x[i * K : (i + 1) * K] for i, t in enumerate(targets)}
        worst, fixed, _ = grid.screen(coef)
        history.append({"qp_iter": it, "constraints": len(pairs), "active": int((lam > 0).sum()), "minDet": min(worst, fixed)})
        if verbose:
            print(f"  qp {it}: constraints={len(pairs)} active={int((lam > 0).sum())} minDet={worst:.4f}", file=sys.stderr)
    params = params_with_targets(base_params, {t: dic.to_ops(coef[t], digits) for t in targets})
    return coef, params, history, worst, fixed


def fit_targets(
    frame,
    base_params,
    samples,
    targets,
    dic,
    ridge=1e-6,
    jac=0.0,
    gate=0.2,
    tau=0.26,
    gate_res=(14,),
    repair_res=(14, 20),
    max_qp_iter=8,
    max_retries=3,
    digits=8,
    verbose=False,
):
    """Distill `targets` jointly (shared design matrix), then enforce the gate.

    Gate = validate.js fieldCheck at res 14 (what the viewer reports); the det
    constraints are also imposed on the finer res-20 grid so the result does
    not hinge on where the grid samples fall. If the constrained QP does not
    reach the gate, ridge and a Jacobian (smoothness) penalty are increased and
    the fit is repeated. Returns a DistillResult.
    """
    t0 = time.time()
    field = BustField(frame, base_params)
    AtA, Atb, btb = normal_equations(field, dic, samples, targets)
    G = None
    grid = GateGrid(frame, base_params, dic, targets, repair_res)
    history = []
    for attempt in range(max_retries + 1):
        if jac > 0 and G is None:
            G = jacobian_gram(field, dic, grid_points(field, gate_res[0])[0])
        H = AtA + regularizer(AtA, ridge, G, jac)
        coef = {t: solve_spd(H, Atb[t]) for t in targets}
        coef, params, hist, worst, fixed = enforce_gate(
            frame, base_params, dic, targets, H, Atb, coef, gate, tau, repair_res, max_qp_iter, digits=digits, verbose=verbose, grid=grid
        )
        history.append({"attempt": attempt, "ridge": ridge, "jac": jac, "qp": hist})
        if worst > gate:
            break
        # Spec fallback: stronger ridge + Jacobian smoothing, refit.
        ridge *= 10
        jac = 1e-3 if jac == 0 else jac * 10
    ops = {t: dic.to_ops(coef[t], digits) for t in targets}
    fstud = BustField(frame, params)
    stats = rms_stats(fstud, samples, targets)
    stats_all = rms_stats(fstud, samples, targets, kinds=(KIND_SKIN, KIND_INTERIOR, KIND_SHELL))
    gmin, gper = gate_check(frame, params, tuple(sorted(set(gate_res) | set(repair_res))))
    gmin_gate = min(gper[r]["minDet"] for r in gate_res)
    return DistillResult(
        params=params,
        coef=coef,
        dictionary=dic,
        targets=list(targets),
        skin=stats,
        all_samples=stats_all,
        gate={
            "threshold": gate,
            "res": list(gate_res),
            "minDet": gmin_gate,
            "minDet_all_res": gmin,
            "per_res": gper,
            "passed": bool(gmin_gate > gate),
            "minDet_fixed_targets_only": fixed,
        },
        history=history,
        atoms_per_side={t: len(ops[t]) for t in targets},
        dofs=dic.K,
        n_samples={k: int((samples.kind == v).sum()) for k, v in (("skin", 0), ("interior", 1), ("shell", 2))},
        seconds=time.time() - t0,
    )


def prune(frame, base_params, samples, targets, dic, budget, ridge=1e-6, frac=0.2, verbose=False):
    """Backward elimination to at most `budget` atoms (= ops per side).

    An atom's importance is the energy of its contribution summed over the
    targets, c_a' H_aa c_a; the weakest fraction is dropped and the rest refit.
    The same atom set is shared by all targets so one design matrix serves all.
    """
    field = BustField(frame, base_params)
    AtA, Atb, _ = normal_equations(field, dic, samples, targets)
    keep = np.arange(len(dic))
    while len(keep) > budget:
        idx = np.concatenate([np.arange(dic.slices[i].start, dic.slices[i].stop) for i in keep])
        H = AtA[np.ix_(idx, idx)]
        H = H + regularizer(H, ridge)
        energy = np.zeros(len(keep))
        coefs = {t: solve_spd(H, Atb[t][idx]) for t in targets}
        off = 0
        for j, i in enumerate(keep):
            n = dic.slices[i].stop - dic.slices[i].start
            Hs = AtA[np.ix_(idx[off : off + n], idx[off : off + n])]
            energy[j] = sum(float(coefs[t][off : off + n] @ Hs @ coefs[t][off : off + n]) for t in targets)
            off += n
        n_drop = max(1, min(len(keep) - budget, int(np.ceil(frac * len(keep)))))
        drop = np.argsort(energy)[:n_drop]
        keep = np.delete(keep, drop)
        if verbose:
            print(f"  prune: {len(keep)} atoms", file=sys.stderr)
    return dic.subset(keep)


# --- teachers ---------------------------------------------------------------------------


def field_teacher(frame, params):
    f = BustField(frame, params)
    return lambda t, P: f.delta(t, P)


def inflation_teacher(frame, params, rates=(0.3, 0.18, 0.5), sigma=(0.09, 0.12, 0.1), centre=(0.0, 0.0, -0.08)):
    """Synthetic analytic teacher: smooth anisotropic inflation of each breast.

    u = g(q) * diag(rates) (q - c) in the side frame, g a Gaussian with
    per-axis sigma, c relative to the apex (S units). Not windowed: it decays
    on its own, so the student's window is an approximation, not a given.
    sigma_x is kept below ~1/3 of the apex-midline distance: a target that
    pushes tissue laterally across the sagittal plane is outside the student
    class by design (the midline lock forbids left/right interpenetration).
    """
    f = BustField(frame, params)
    S = f.S
    rates = np.asarray(rates)
    sigma = np.asarray(sigma) * S
    c = np.array([centre[0] * S, centre[1] * S, centre[2] * S + f.depth])

    def teach(t, P):
        P = np.asarray(P, dtype=float)
        out = np.zeros_like(P)
        for side in f.sides:
            Q = f.to_side(side, P)
            r = Q - c
            g = np.exp(-0.5 * np.sum((r / sigma) ** 2, axis=-1))
            out += f.from_side_vec(side, g[:, None] * rates * r)
        return out

    return teach


# --- CLI ----------------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m bustfield.distill", description=__doc__.split("\n\n")[0])
    ap.add_argument("--bind", required=True, help="bust-bind/1 export (frame, params, skin geometry)")
    ap.add_argument("--params", help="base params JSON (default: the params stored in the bind export)")
    ap.add_argument("--teacher", default="self", help="self | params:FILE | inflate | samples:FILE.npz")
    ap.add_argument("--targets", default="all", help="comma-separated target names or 'all'")
    ap.add_argument("--skin", default="UP_Skin,UP*", help="material patterns of the skin + clothes layers")
    ap.add_argument("--budget", type=int, default=64, help="max atoms (ops) per side")
    ap.add_argument("--ridge", type=float, default=1e-6)
    ap.add_argument("--gate", type=float, default=0.2)
    ap.add_argument("--out", required=True, help="output params JSON (DEFAULT_PARAMS shape)")
    ap.add_argument("--report", help="output report JSON")
    ap.add_argument("--verify-js", action="store_true", help="round-trip the result through field.js (node)")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    from .bind import Bind
    from .schema import validate as validate_schema

    bind = Bind.load(a.bind)
    frame = bind.frame
    base = json.load(open(a.params)) if a.params else clone_params(bind.params)
    validate_schema(base)
    targets = TARGETS if a.targets == "all" else a.targets.split(",")
    field = BustField(frame, base)
    P, N = bind.select(a.skin.split(","))

    if a.teacher == "self":
        teacher = field_teacher(frame, base)
    elif a.teacher.startswith("params:"):
        teacher = field_teacher(frame, json.load(open(a.teacher[7:])))
    elif a.teacher == "inflate":
        teacher = inflation_teacher(frame, base)
    elif a.teacher.startswith("samples:"):
        teacher = None
    else:
        ap.error(f"unknown teacher {a.teacher}")
    outside = None
    if teacher is None:
        samples = Samples.load(a.teacher[8:])
        targets = [t for t in targets if t in samples.U]
        # Teacher motion outside the window cannot be represented (the field is
        # exactly 0 there); drop those samples but report how much was lost.
        m = field.weight(samples.P) > 0
        umax = {t: float(np.linalg.norm(samples.U[t], axis=1).max()) for t in targets}
        outside = {
            "dropped": int((~m).sum()),
            "max_disp_rel": {t: float(np.linalg.norm(samples.U[t][~m], axis=1).max(initial=0.0)) / max(umax[t], 1e-300) for t in targets},
        }
        samples = samples.subset(m)
    else:
        samples = make_samples(field, P, N, targets, teacher)

    dic = Dictionary.lattice()
    if len(dic) > a.budget:
        dic = prune(frame, base, samples, targets, dic, a.budget, a.ridge, verbose=a.verbose)
    res = fit_targets(frame, base, samples, targets, dic, ridge=a.ridge, gate=a.gate, verbose=a.verbose)
    rep = res.report()
    if teacher is not None:
        # Held-out check: triangle centroids were never fitted.
        C = bind.centroids(a.skin.split(","))
        C = C[field.weight(C) > 0]
        if len(C):
            ho = Samples(C, {t: teacher(t, C) for t in targets}, np.ones(len(C)), np.zeros(len(C), int))
            rep["holdout_centroids"] = rms_stats(BustField(frame, res.params), ho, targets)
    if outside is not None:
        rep["teacher_outside_window"] = outside
    if a.verify_js:
        from .jsbridge import compare_with_js

        skin = samples.P[samples.kind == KIND_SKIN]
        rep["js_roundtrip"] = compare_with_js(frame, res.params, skin[:: max(1, len(skin) // 300)], targets)
    validate_schema(res.params)
    with open(a.out, "w") as f:
        json.dump(res.params, f, indent=1)
    if a.report:
        with open(a.report, "w") as f:
            json.dump(json_safe(rep), f, indent=1)
    worst = max(v["rel_rms"] for v in res.skin.values())
    print(
        f"distilled {len(targets)} targets, {max(res.atoms_per_side.values())} atoms/side, "
        f"worst skin RMS {100 * worst:.2f}% of max displacement, gate minDet {res.gate['minDet']:.3f} "
        f"at res {res.gate['res']} ({'pass' if res.gate['passed'] else 'FAIL'}; all grids "
        f"{res.gate['minDet_all_res']:.3f}), {res.seconds:.1f}s"
    )
    fx = res.gate["minDet_fixed_targets_only"]
    if not res.gate["passed"] and fx is not None and fx <= a.gate:
        print(f"gate fails in slider combos that only use the targets NOT distilled here (min det {fx:.3f}); distill those too")
    if "holdout_centroids" in rep:
        ho = rep["holdout_centroids"]
        print(f"held-out triangle centroids ({next(iter(ho.values()))['n']}): worst RMS {100 * max(v['rel_rms'] for v in ho.values()):.2f}%")
    if "js_roundtrip" in rep:
        r = rep["js_roundtrip"]
        print(f"field.js round trip: max |delta| diff {r['delta'] / r['S']:.2e} S, |J| diff {r['jacobian']:.2e}")
    return 0 if res.gate["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
