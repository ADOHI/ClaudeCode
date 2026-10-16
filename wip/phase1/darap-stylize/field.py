"""NumPy port of web/src/core/field.js + kelvinlet.js (evaluation only).

Used for (1) the input displacement this teacher stylizes on top of (e.g. the
current bust_size_up_stylized target) and (2) the window weight that defines
the region of interest and its Dirichlet boundary. tests/test_field.py checks
it against the JS module through node, so drift in field.js is caught.
(When tools/bustfield lands, this can be replaced by its field.py.)
"""

import numpy as np

EPS_SCALE = np.array([1.0, 2.0, 4.0])


def _tri_weights(e):
    e1, e2, e3 = e ** 2
    return np.array([1.0, -(e3 - e1) / (e3 - e2), (e2 - e1) / (e3 - e2)])


TRI_W = _tri_weights(EPS_SCALE)


def _coeffs(nu):
    a = 1 / (4 * np.pi)
    return a, a / (4 * (1 - nu))


def kelvin_grab(r, d, eps, nu):
    """Regularized tri-scale Kelvinlet grab (de Goes & James 2017); u(0) = d."""
    a, b = _coeffs(nu)
    r2 = np.einsum('ij,ij->i', r, r)
    rd = r @ np.asarray(d, float)
    s1 = np.zeros(len(r))
    s2 = np.zeros(len(r))
    norm = 0.0
    for i in range(3):
        e = eps * EPS_SCALE[i]
        re2 = r2 + e * e
        re = np.sqrt(re2)
        re3 = re2 * re
        s1 += TRI_W[i] * ((a - b) / re + (a * e * e) / (2 * re3))
        s2 += TRI_W[i] * (b / re3)
        norm += TRI_W[i] * ((3 * a - 2 * b) / (2 * e))
    return (s1 / norm)[:, None] * np.asarray(d, float)[None] + ((s2 * rd) / norm)[:, None] * r


def kelvin_scale(r, k, eps, nu):
    a, b = _coeffs(nu)
    c = 2 * b - a
    if abs(c) < 1e-9:
        return np.zeros_like(r)
    r2 = np.einsum('ij,ij->i', r, r)
    s = np.zeros(len(r))
    norm = 0.0
    for i in range(3):
        e = eps * EPS_SCALE[i]
        re2 = r2 + e * e
        re = np.sqrt(re2)
        re3 = re2 * re
        re5 = re3 * re2
        s += TRI_W[i] * c * (1 / re3 + (3 * e * e) / (2 * re5))
        norm += TRI_W[i] * c * (5 / (2 * e * e * e))
    return ((k * s) / norm)[:, None] * r


def _smoother(t):
    t = np.minimum(t, 1.0)
    return 1 - t * t * t * (t * (t * 6 - 15) + 10)


def falloff(t, hard):
    """1 inside the plateau, smootherstep (C2) to 0 at t = 1 (field.js falloff)."""
    t = np.asarray(t, float)
    u = np.clip((t - hard) / (1 - hard), 0, 1) if hard < 1 else (t >= 1).astype(float)
    out = 1 - u * u * u * (u * (u * 6 - 15) + 10)
    return np.where(t <= hard, 1.0, np.where(t >= 1, 0.0, out))


class BustField:
    """createBustField(frame, params) for arrays of bind-space points (n,3)."""

    def __init__(self, frame, params):
        self.frame = frame
        self.P = params
        S = self.S = frame.S
        W = params['window']
        self.R = {k: W[k] * S for k in ('x', 'yUp', 'yDown', 'zFront', 'zBack')}
        self.depth = params['depth'] * S
        self.physical = params.get('kernel', 'kelvinlet') != 'smooth'
        an = params['anchor']
        self.sides = []
        for s in (1, -1):
            x_axis = frame.left * s
            base = frame.from_body([[s * an['x'], an['y'], an['z']]])[0]
            apex = base + frame.forward * self.depth
            self.sides.append({'s': s, 'xAxis': x_axis, 'base': base, 'apex': apex})
        self.targets = {}
        for name, ops in params['targets'].items():
            self.targets[name] = [
                {
                    'type': op['type'],
                    'at': np.array([op['at'][0] * S, op['at'][1] * S, op['at'][2] * S + self.depth]),
                    'd': None if op.get('d') is None else np.asarray(op['d'], float) * S,
                    'k': op.get('k', 0.0) or 0.0,
                    'eps': op['radius'] * S,
                    'nu': op.get('nu', 0.45) if op.get('nu') is not None else 0.45,
                }
                for op in ops
            ]
        self.mid = params.get('midline', 0.1) * S
        lock = params.get('midlineLock', 0.15)
        self.mid_lock = (0.15 if lock is None else lock) * S

    # --- frames -------------------------------------------------------------
    def side_axes(self, side):
        return np.stack([side['xAxis'], self.frame.up, self.frame.forward])

    def to_side(self, side, p):
        """bind points -> side frame (x outward, y up, z forward) relative to the base centre."""
        return (np.asarray(p, float) - side['base']) @ self.side_axes(side).T

    def from_side_vec(self, side, v):
        return np.asarray(v, float) @ self.side_axes(side)

    # --- weights ------------------------------------------------------------
    def window_weight(self, q):
        Wn = self.P['window']
        ry = np.where(q[:, 1] >= 0, self.R['yUp'], self.R['yDown'])
        wl = falloff(np.hypot(q[:, 0] / self.R['x'], q[:, 1] / ry), Wn['hardness'])
        wz = np.where(
            q[:, 2] >= 0,
            falloff(q[:, 2] / self.R['zFront'], Wn['hardnessZ']),
            falloff(-q[:, 2] / self.R['zBack'], Wn['hardnessZ']),
        )
        return wl * wz

    def side_share(self, side, p):
        x = side['s'] * ((np.asarray(p, float) - self.frame.origin) @ self.frame.left)
        mid = self.mid
        out = falloff((mid - x) / (2 * mid), 0)
        return np.where(x >= mid, 1.0, np.where(x <= -mid, 0.0, out))

    def side_weight(self, side, p):
        return self.window_weight(self.to_side(side, p)) * self.side_share(side, p)

    def weight(self, p):
        """Max side weight (0 => outside the support)."""
        return np.maximum(*[self.side_weight(sd, p) for sd in self.sides])

    # --- displacement ------------------------------------------------------
    def brushes(self, name, q):
        u = np.zeros_like(q)
        for op in self.targets[name]:
            r = q - op['at']
            if op['type'] == 'grab':
                u += kelvin_grab(r, op['d'], op['eps'], op['nu']) if self.physical else op['d'][None] * _smoother(np.linalg.norm(r, axis=1) / (op['eps'] * 3))[:, None]
            elif op['type'] == 'scale':
                u += kelvin_scale(r, op['k'], op['eps'], op['nu']) if self.physical else r * (op['k'] * _smoother(np.linalg.norm(r, axis=1) / (op['eps'] * 3)))[:, None]
            else:
                raise ValueError(f"unknown brush {op['type']}")
        return u

    def lock_lateral(self, p, d):
        if self.mid_lock <= 0:
            return d
        x = np.abs((p - self.frame.origin) @ self.frame.left)
        t = np.minimum(x / self.mid_lock, 1.0)
        k = t * (2 - t) - 1
        dl = (d @ self.frame.left) * np.where(x >= self.mid_lock, 0.0, k)
        return d + dl[:, None] * self.frame.left[None]

    def delta(self, name, p):
        """Bind-space displacement of target `name` at bind points p (unmasked)."""
        p = np.atleast_2d(np.asarray(p, float))
        out = np.zeros_like(p)
        anyw = np.zeros(len(p), bool)
        for side in self.sides:
            q = self.to_side(side, p)
            w = self.window_weight(q) * self.side_share(side, p)
            m = w > 0
            if not m.any():
                continue
            anyw |= m
            out[m] += self.from_side_vec(side, self.brushes(name, q[m])) * w[m, None]
        locked = self.lock_lateral(p, out)
        return np.where(anyw[:, None], locked, out)
