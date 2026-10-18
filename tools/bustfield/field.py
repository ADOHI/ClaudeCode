"""Bust deformation field: numpy port of web/src/core/field.js.

Field of one target = sum over sides  W(q) * share(p) * sum over brushes K(q),
followed by the midline lateral lock. Every step after the brush sum is linear
in the brush amplitudes, which is what makes distillation a linear
least-squares problem (see ``BustField.assemble``).

Evaluation is vectorized: ``delta(name, P)`` takes (N, 3) bind-space points
(or a single (3,) point) and returns the same shape. The arithmetic follows the
JS operation order; tests/test_parity.py checks agreement with field.js via
web/scripts/eval-field.mjs to 1e-9 * S.
"""

import copy
import json

import numpy as np

from . import kelvinlet as kv
from .vec import add, clamp, cross, dot, dot_n, length, normalize, scale, sub

# Same values as DEFAULT_PARAMS in field.js (the parity test compares them).
DEFAULT_PARAMS = {
    "anchor": {"x": 0.24, "y": 0.05, "z": 0.2},
    "depth": 0.2,
    "window": {"x": 0.32, "yUp": 0.44, "yDown": 0.42, "zFront": 1.0, "zBack": 0.3, "hardness": 0.15, "hardnessZ": 0.3},
    "midline": 0.1,
    "midlineLock": 0.15,
    "kernel": "kelvinlet",
    "targets": {
        "bust_size_up_natural": [
            {"type": "scale", "at": [0, -0.04, -0.09], "k": 0.55, "radius": 0.19, "nu": 0.2},
            {"type": "grab", "at": [0, -0.03, -0.08], "d": [0.0, -0.03, 0.015], "radius": 0.2, "nu": 0.45},
        ],
        "bust_size_up_stylized": [
            {"type": "scale", "at": [0, 0.015, -0.09], "k": 0.6, "radius": 0.19, "nu": 0.2},
            {"type": "grab", "at": [0, 0.0, -0.08], "d": [0.0, 0.035, 0.025], "radius": 0.21, "nu": 0.45},
        ],
        "bust_size_down": [
            {"type": "scale", "at": [0, -0.02, -0.09], "k": -0.4, "radius": 0.19, "nu": 0.2},
            {"type": "grab", "at": [0, 0, -0.08], "d": [0, 0.01, -0.015], "radius": 0.2, "nu": 0.45},
        ],
        "bust_lift_up": [{"type": "grab", "at": [0, 0, -0.08], "d": [0, 0.07, 0.005], "radius": 0.19, "nu": 0.48}],
        "bust_lift_down": [{"type": "grab", "at": [0, 0, -0.08], "d": [0, -0.08, -0.005], "radius": 0.19, "nu": 0.48}],
        "bust_spread_out": [{"type": "grab", "at": [0, 0, -0.08], "d": [0.065, 0, 0], "radius": 0.19, "nu": 0.48}],
        "bust_spread_in": [{"type": "grab", "at": [0, 0, -0.08], "d": [-0.065, 0, 0], "radius": 0.19, "nu": 0.48}],
    },
    "mask": {"excludeArms": True, "excludeHead": True},
}

TARGETS = list(DEFAULT_PARAMS["targets"].keys())


def clone_params(p):
    return json.loads(json.dumps(p))


def _nn(v, default):
    """JS `v ?? default`."""
    return default if v is None else v


def slider_to_weights(size=0, style=0.5, lift=0, spread=0):
    """Bipolar UI sliders -> one-sided blend shape weights in 0..1."""
    size = clamp(size, -1, 1)
    style = clamp(style, 0, 1)
    lift = clamp(lift, -1, 1)
    spread = clamp(spread, -1, 1)
    up = max(size, 0)
    return {
        "bust_size_up_natural": up * (1 - style),
        "bust_size_up_stylized": up * style,
        "bust_size_down": max(-size, 0),
        "bust_lift_up": max(lift, 0),
        "bust_lift_down": max(-lift, 0),
        "bust_spread_out": max(spread, 0),
        "bust_spread_in": max(-spread, 0),
    }


# --- body frame -------------------------------------------------------------------


def build_body_frame(hips, chest, neck, leftUpperArm, rightUpperArm):
    """Body frame from five bind-space joints (right-handed, like field.js)."""
    lr = sub(leftUpperArm, rightUpperArm)
    S = length(lr)
    left = normalize(lr)
    up_raw = sub(neck, hips)
    up = normalize(sub(up_raw, scale(left, dot(up_raw, left))))
    forward = cross(left, up)
    mid = scale(add(leftUpperArm, rightUpperArm), 0.5)
    origin = sub(chest, scale(left, dot(sub(chest, mid), left)))
    frame = {"origin": origin, "left": left, "up": up, "forward": forward, "S": S}
    frame["hipsY"] = to_body(frame, hips)[1]
    frame["neckY"] = to_body(frame, neck)[1]
    return frame


def to_body(f, p):
    """Bind space -> body frame coordinates; p is (3,) or (N, 3)."""
    p = np.asarray(p, dtype=float)
    o = f["origin"]
    d = np.stack([p[..., 0] - o[0], p[..., 1] - o[1], p[..., 2] - o[2]], axis=-1)
    out = np.stack([dot_n(d, f["left"]), dot_n(d, f["up"]), dot_n(d, f["forward"])], axis=-1)
    return out if out.ndim > 1 else [float(v) for v in out]


def from_body(f, b):
    b = np.asarray(b, dtype=float)
    o, l, u, fw = f["origin"], f["left"], f["up"], f["forward"]
    out = np.stack(
        [o[i] + l[i] * b[..., 0] + u[i] * b[..., 1] + fw[i] * b[..., 2] for i in range(3)],
        axis=-1,
    )
    return out if out.ndim > 1 else [float(v) for v in out]


def falloff(t, hard):
    """1 inside the plateau, smootherstep (C2) down to 0 at t = 1."""
    t = np.asarray(t, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        u = (t - hard) / (1 - hard)
        v = 1 - u * u * u * (u * (u * 6 - 15) + 10)
    return np.where(t <= hard, 1.0, np.where(t >= 1, 0.0, v))


def linear_brush(r, A, eps=0):
    """Row-major affine strain/rotation brush, matching field.js linearBrush."""
    r = np.asarray(r, dtype=float)
    A = np.asarray(A, dtype=float).reshape(3, 3)
    # Keep the summation order identical to JS, including on rotated frames.
    v = np.stack([A[i, 0] * r[..., 0] + A[i, 1] * r[..., 1] + A[i, 2] * r[..., 2]
                  for i in range(3)], axis=-1)
    if eps > 0:
        w = falloff(np.linalg.norm(r, axis=-1) / eps, 0)
        v = v * w[..., None]
    return v


class Side:
    def __init__(self, s, x_axis, base, apex):
        self.s = s
        self.x_axis = x_axis
        self.base = base
        self.apex = apex


class BustField:
    """Vectorized equivalent of createBustField(frame, params)."""

    def __init__(self, frame, params=None):
        params = DEFAULT_PARAMS if params is None else params
        self.frame = frame
        self.params = params
        S = float(frame["S"])
        self.S = S
        P = params
        Wn = P["window"]
        self.Wn = Wn
        self.R = {
            "x": Wn["x"] * S,
            "yUp": Wn["yUp"] * S,
            "yDown": Wn["yDown"] * S,
            "zFront": Wn["zFront"] * S,
            "zBack": Wn["zBack"] * S,
        }
        self.depth = P["depth"] * S
        self.physical = P.get("kernel") != "smooth"

        self.sides = []
        for s in (1, -1):
            x_axis = scale(frame["left"], s)
            a = P["anchor"]
            base = from_body(frame, [s * a["x"] * S, a["y"] * S, a["z"] * S])
            apex = add(base, scale(frame["forward"], self.depth))
            self.sides.append(Side(s, x_axis, base, apex))

        # Brushes in side-frame coordinates (absolute units) relative to the base.
        self._ops = {}
        for name, ops in P["targets"].items():
            self._ops[name] = [self._resolve(op) for op in ops]
        self.targets = list(self._ops.keys())

        self.mid = _nn(P.get("midline"), 0.1) * S
        self.mid_lock = _nn(P.get("midlineLock"), 0.15) * S
        self.h = 1e-3 * S
        R = self.R
        self.box = {"x": [-R["x"], R["x"]], "y": [-R["yDown"], R["yUp"]], "z": [-R["zBack"], R["zFront"]]}

    def _resolve(self, op):
        S = self.S
        at = op["at"]
        d = op.get("d")
        return {
            "type": op["type"],
            "at": [at[0] * S, at[1] * S, at[2] * S + self.depth],
            "d": [v * S for v in d] if d else None,
            "k": _nn(op.get("k"), 0),
            "eps": _nn(op.get("radius"), 0) * S,
            "nu": _nn(op.get("nu"), 0.45),
            "A": op.get("A"),
            "parity": _nn(op.get("parity"), 1),
        }

    # --- geometry --------------------------------------------------------------
    def window_weight(self, Q):
        Q = np.asarray(Q, dtype=float)
        R, Wn = self.R, self.Wn
        ry = np.where(Q[..., 1] >= 0, R["yUp"], R["yDown"])
        wl = falloff(np.hypot(Q[..., 0] / R["x"], Q[..., 1] / ry), Wn["hardness"])
        wz = np.where(
            Q[..., 2] >= 0,
            falloff(Q[..., 2] / R["zFront"], Wn["hardnessZ"]),
            falloff(-Q[..., 2] / R["zBack"], Wn["hardnessZ"]),
        )
        return np.where(wl == 0, 0.0, wl * wz)

    def to_side(self, side, P):
        P = np.asarray(P, dtype=float)
        b = side.base
        d = np.stack([P[..., 0] - b[0], P[..., 1] - b[1], P[..., 2] - b[2]], axis=-1)
        return np.stack([dot_n(d, side.x_axis), dot_n(d, self.frame["up"]), dot_n(d, self.frame["forward"])], axis=-1)

    def side_share(self, side, P):
        """Partition of unity across the midline: share_L + share_R = 1 (C2)."""
        o = self.frame["origin"]
        P = np.asarray(P, dtype=float)
        d = np.stack([P[..., 0] - o[0], P[..., 1] - o[1], P[..., 2] - o[2]], axis=-1)
        x = side.s * dot_n(d, self.frame["left"])
        mid = self.mid
        with np.errstate(divide="ignore", invalid="ignore"):
            f = falloff((mid - x) / (2 * mid), 0)
        return np.where(x >= mid, 1.0, np.where(x <= -mid, 0.0, f))

    def side_weight(self, side, P, Q):
        w = self.window_weight(Q)
        return np.where(w == 0, 0.0, w * self.side_share(side, P))

    def from_side_vec(self, side, V):
        """Side-frame vectors (..., 3) -> bind space."""
        V = np.asarray(V, dtype=float)
        a, u, f = side.x_axis, self.frame["up"], self.frame["forward"]
        v0, v1, v2 = V[..., 0], V[..., 1], V[..., 2]
        return np.stack([a[i] * v0 + u[i] * v1 + f[i] * v2 for i in range(3)], axis=-1)

    def from_side_cols(self, side, C):
        """Side-frame columns (..., 3, K) -> bind space (..., 3, K)."""
        a, u, f = side.x_axis, self.frame["up"], self.frame["forward"]
        c0, c1, c2 = C[..., 0, :], C[..., 1, :], C[..., 2, :]
        return np.stack([a[i] * c0 + u[i] * c1 + f[i] * c2 for i in range(3)], axis=-2)

    def weight(self, P):
        """Max side weight over both sides (0 => outside the support)."""
        P = np.asarray(P, dtype=float)
        m = np.zeros(P.shape[:-1])
        for side in self.sides:
            m = np.maximum(m, self.side_weight(side, P, self.to_side(side, P)))
        return m

    def lock_lateral(self, P, D):
        """Midline constraint: lateral component scaled by psi(|x| / m) = t(2 - t).

        D is (N, 3) or columns (N, 3, K); linear in D.
        """
        if self.mid_lock <= 0:
            return D
        o, L = self.frame["origin"], self.frame["left"]
        P = np.asarray(P, dtype=float)
        d = np.stack([P[..., 0] - o[0], P[..., 1] - o[1], P[..., 2] - o[2]], axis=-1)
        x = np.abs(dot_n(d, L))
        t = x / self.mid_lock
        k = np.where(x >= self.mid_lock, 0.0, t * (2 - t) - 1)  # psi - 1
        if D.ndim == P.ndim + 1:  # columns
            dl = (D[..., 0, :] * L[0] + D[..., 1, :] * L[1] + D[..., 2, :] * L[2]) * k[..., None]
            return np.stack([D[..., i, :] + L[i] * dl for i in range(3)], axis=-2)
        dl = dot_n(D, L) * k
        return np.stack([D[..., i] + L[i] * dl for i in range(3)], axis=-1)

    # --- brushes ------------------------------------------------------------------
    def brushes(self, name, Q, s=1):
        """Unwindowed brush sum in the side frame."""
        if name not in self._ops:
            raise KeyError(f"unknown target {name}")
        Q = np.asarray(Q, dtype=float)
        u = np.zeros(Q.shape)
        for op in self._ops[name]:
            at = op["at"]
            r = np.stack([Q[..., 0] - at[0], Q[..., 1] - at[1], Q[..., 2] - at[2]], axis=-1)
            if op["type"] == "grab":
                v = kv.grab(r, op["d"], op["eps"], op["nu"]) if self.physical else kv.grab_smooth(r, op["d"], op["eps"])
            elif op["type"] == "scale":
                v = (
                    kv.scale_brush(r, op["k"], op["eps"], op["nu"])
                    if self.physical
                    else kv.scale_smooth(r, op["k"], op["eps"])
                )
            elif op["type"] == "linear":
                v = linear_brush(r, op["A"], op["eps"])
            else:
                raise ValueError(f"unknown brush {op['type']}")
            u = u - v if op["parity"] < 0 and s < 0 else u + v
        return u

    def delta(self, name, P):
        """Bind-space displacement of target `name` at bind-space points (unmasked)."""
        P = np.asarray(P, dtype=float)
        single = P.ndim == 1
        P2 = P[None] if single else P
        out = np.zeros(P2.shape)
        for side in self.sides:
            Q = self.to_side(side, P2)
            w = self.side_weight(side, P2, Q)
            nz = w != 0
            if not nz.any():
                continue
            # Brushes only where the window is non-zero (JS skips the rest).
            v = self.from_side_vec(side, self.brushes(name, Q[nz], side.s))
            out[nz] = out[nz] + v * w[nz][:, None]
        out = self.lock_lateral(P2, out)
        return out[0] if single else out

    def jacobian(self, name, P):
        """d(delta)/dp by central differences (h = 1e-3 S), shape (N, 3, 3)."""
        P = np.asarray(P, dtype=float)
        single = P.ndim == 1
        P2 = P[None] if single else P
        J = np.empty(P2.shape[:-1] + (3, 3))
        h = self.h
        for j in range(3):
            pp = P2.copy()
            pm = P2.copy()
            pp[..., j] += h
            pm[..., j] -= h
            a = self.delta(name, pp)
            b = self.delta(name, pm)
            J[..., :, j] = (a - b) / (2 * h)
        return J[0] if single else J

    # --- linear structure used by distillation -----------------------------------
    def assemble(self, P, side_columns, K):
        """Apply window, midline share, side->bind rotation and lateral lock to
        side-frame brush columns. ``side_columns(Q)`` returns (M, 3, K) columns
        (absolute units) at side-frame points Q (M, 3). The result A (N, 3, K)
        satisfies delta(P) == A @ amplitudes: the exact linear map of the field.
        """
        P = np.asarray(P, dtype=float)
        out = np.zeros(P.shape[:-1] + (3, K))
        for side in self.sides:
            Q = self.to_side(side, P)
            w = self.side_weight(side, P, Q)
            nz = np.nonzero(w != 0)[0]
            if nz.size == 0:
                continue
            out[nz] += self.from_side_cols(side, side_columns(Q[nz])) * w[nz][:, None, None]
        return self.lock_lateral(P, out)

    def apex_body(self, side_index=0):
        return to_body(self.frame, self.sides[side_index].apex)


def create_bust_field(frame, params=None):
    return BustField(frame, params)


def params_with_targets(base, targets):
    """Copy of `base` params with `targets` replaced/extended."""
    p = copy.deepcopy(base)
    p.setdefault("targets", {})
    p["targets"] = {**p["targets"], **targets}
    return p


def side_to_apex(field, Q):
    """Side-frame coords relative to the base -> relative to the apex, in S units."""
    S = field.S
    Q = np.asarray(Q, dtype=float)
    return np.stack([Q[..., 0] / S, Q[..., 1] / S, (Q[..., 2] - field.depth) / S], axis=-1)


__all__ = [
    "DEFAULT_PARAMS",
    "TARGETS",
    "BustField",
    "build_body_frame",
    "clone_params",
    "create_bust_field",
    "falloff",
    "linear_brush",
    "from_body",
    "params_with_targets",
    "slider_to_weights",
    "to_body",
    "side_to_apex",
]
