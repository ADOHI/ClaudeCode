"""Regularized Kelvinlets: numpy port of web/src/core/kelvinlet.js.

de Goes & James, "Regularized Kelvinlets", SIGGRAPH 2017. Tri-scale
(eps * {1, 2, 4}) extrapolation makes the brushes local (1/r^5 decay).

Every function is vectorized over the leading axes of ``r`` (shape (..., 3)).
The arithmetic is written in the same order as the JS so the two agree to the
last bit in most cases; the parity tests only require 1e-9 * S.

Besides the ports of ``grab`` / ``scaleBrush`` this module exposes their
*bases* (``grab_basis``, ``scale_basis``): the brushes are linear in the
amplitude (d or k), so u = G(r) d and u = k v(r). Distillation builds its
design matrix from these.
"""

import math

import numpy as np

EPS_SCALE = (1.0, 2.0, 4.0)


def _tri_weights(e):
    e1, e2, e3 = (x * x for x in e)
    return (1.0, -(e3 - e1) / (e3 - e2), (e2 - e1) / (e3 - e2))


W = _tri_weights(EPS_SCALE)


def coeffs(nu):
    # Shear modulus cancels after normalization; use mu = 1.
    a = 1 / (4 * math.pi)
    b = a / (4 * (1 - nu))
    return a, b


def _r2(r):
    return r[..., 0] * r[..., 0] + r[..., 1] * r[..., 1] + r[..., 2] * r[..., 2]


def _grab_terms(r2, eps, nu):
    """s1, s2 and the normalization of the grab brush (u = (s1 I + s2 r r^T) f)."""
    a, b = coeffs(nu)
    s1 = 0.0
    s2 = 0.0
    norm = 0.0
    for i in range(3):
        e = eps * EPS_SCALE[i]
        re2 = r2 + e * e
        re = np.sqrt(re2)
        re3 = re2 * re
        s1 = s1 + W[i] * ((a - b) / re + (a * e * e) / (2 * re3))
        s2 = s2 + W[i] * (b / re3)
        norm = norm + W[i] * ((3 * a - 2 * b) / (2 * e))  # u_eps(0) / f
    return s1, s2, norm


def grab(r, d, eps, nu):
    """Grab brush: displacement at offset r whose value at the centre is d."""
    r = np.asarray(r, dtype=float)
    d = np.asarray(d, dtype=float)
    s1, s2, norm = _grab_terms(_r2(r), eps, nu)
    rd = r[..., 0] * d[..., 0] + r[..., 1] * d[..., 1] + r[..., 2] * d[..., 2]
    k1 = s1 / norm
    k2 = (s2 * rd) / norm
    k1 = np.asarray(k1)[..., None]
    k2 = np.asarray(k2)[..., None]
    return k1 * d + k2 * r


def grab_basis(r, eps, nu):
    """G with grab(r, d) == G @ d, shape (..., 3, 3)."""
    r = np.asarray(r, dtype=float)
    s1, s2, norm = _grab_terms(_r2(r), eps, nu)
    k1 = np.asarray(s1 / norm)[..., None, None]
    k2 = np.asarray(s2 / norm)[..., None, None]
    return k1 * np.eye(3) + k2 * (r[..., :, None] * r[..., None, :])


def _scale_terms(r2, eps, nu):
    a, b = coeffs(nu)
    c = 2 * b - a
    if abs(c) < 1e-9:
        return None
    s = 0.0
    norm = 0.0
    for i in range(3):
        e = eps * EPS_SCALE[i]
        re2 = r2 + e * e
        re = np.sqrt(re2)
        re3 = re2 * re
        re5 = re3 * re2
        s = s + W[i] * c * (1 / re3 + (3 * e * e) / (2 * re5))
        norm = norm + W[i] * c * (5 / (2 * e * e * e))  # bracket at r = 0
    return s, norm


def scale_brush(r, k, eps, nu):
    """Scale (dilation) brush: u ~= k r near the centre. Zero for nu = 0.5."""
    r = np.asarray(r, dtype=float)
    t = _scale_terms(_r2(r), eps, nu)
    if t is None:
        return np.zeros_like(r)
    s, norm = t
    f = np.asarray((k * s) / norm)[..., None]
    return f * r


def scale_basis(r, eps, nu):
    """v with scale_brush(r, k) == k * v, shape (..., 3)."""
    r = np.asarray(r, dtype=float)
    t = _scale_terms(_r2(r), eps, nu)
    if t is None:
        return np.zeros_like(r)
    s, norm = t
    return np.asarray(s / norm)[..., None] * r


# Non-physical baseline kernels (smootherstep falloff) for A/B comparison.
def smoother(t):
    t = np.asarray(t, dtype=float)
    return np.where(t >= 1, 0.0, 1 - t * t * t * (t * (t * 6 - 15) + 10))


def _hypot3(r):
    return np.sqrt(_r2(r))


def grab_smooth(r, d, eps):
    r = np.asarray(r, dtype=float)
    f = smoother(_hypot3(r) / (eps * 3))[..., None]
    return np.asarray(d, dtype=float) * f


def scale_smooth(r, k, eps):
    r = np.asarray(r, dtype=float)
    f = (k * smoother(_hypot3(r) / (eps * 3)))[..., None]
    return r * f


def grab_smooth_basis(r, eps):
    r = np.asarray(r, dtype=float)
    f = smoother(_hypot3(r) / (eps * 3))[..., None, None]
    return f * np.eye(3)


def scale_smooth_basis(r, eps):
    r = np.asarray(r, dtype=float)
    return r * smoother(_hypot3(r) / (eps * 3))[..., None]
