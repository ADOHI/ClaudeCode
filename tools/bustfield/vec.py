"""Small 3-vector / 3x3 helpers mirroring web/src/core/vec.js.

Scalar helpers take plain sequences of 3 floats (frames, anchors) and keep the
JS operation order. The ``*_n`` helpers are vectorized over a leading axis and
are what the field uses for many points at once. 3x3 matrices are numpy arrays
of shape (..., 3, 3) (row-major like the JS ``m3*`` helpers).
"""

import math

import numpy as np


def add(a, b):
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def scale(a, s):
    return [a[0] * s, a[1] * s, a[2] * s]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def length(a):
    return math.hypot(a[0], a[1], a[2])


def normalize(a):
    n = length(a)
    return scale(a, 1 / n) if n > 0 else [0.0, 0.0, 0.0]


def clamp(x, a, b):
    return a if x < a else b if x > b else x


# --- vectorized (leading axis = points) ---------------------------------------


def dot_n(v, a):
    """Row-wise dot of (N, 3) points with a fixed 3-vector (JS order)."""
    return v[..., 0] * a[0] + v[..., 1] * a[1] + v[..., 2] * a[2]


def m3det(m):
    """Determinant of (..., 3, 3), same expansion as vec.js m3Det."""
    return (
        m[..., 0, 0] * (m[..., 1, 1] * m[..., 2, 2] - m[..., 1, 2] * m[..., 2, 1])
        - m[..., 0, 1] * (m[..., 1, 0] * m[..., 2, 2] - m[..., 1, 2] * m[..., 2, 0])
        + m[..., 0, 2] * (m[..., 1, 0] * m[..., 2, 1] - m[..., 1, 1] * m[..., 2, 0])
    )


def m3cof(m):
    """Cofactor matrix C (d det(M) = <C, dM>, C = adj(M)^T), shape (..., 3, 3)."""
    c = np.empty(m.shape, dtype=float)
    c[..., 0, 0] = m[..., 1, 1] * m[..., 2, 2] - m[..., 1, 2] * m[..., 2, 1]
    c[..., 0, 1] = m[..., 1, 2] * m[..., 2, 0] - m[..., 1, 0] * m[..., 2, 2]
    c[..., 0, 2] = m[..., 1, 0] * m[..., 2, 1] - m[..., 1, 1] * m[..., 2, 0]
    c[..., 1, 0] = m[..., 0, 2] * m[..., 2, 1] - m[..., 0, 1] * m[..., 2, 2]
    c[..., 1, 1] = m[..., 0, 0] * m[..., 2, 2] - m[..., 0, 2] * m[..., 2, 0]
    c[..., 1, 2] = m[..., 0, 1] * m[..., 2, 0] - m[..., 0, 0] * m[..., 2, 1]
    c[..., 2, 0] = m[..., 0, 1] * m[..., 1, 2] - m[..., 0, 2] * m[..., 1, 1]
    c[..., 2, 1] = m[..., 0, 2] * m[..., 1, 0] - m[..., 0, 0] * m[..., 1, 2]
    c[..., 2, 2] = m[..., 0, 0] * m[..., 1, 1] - m[..., 0, 1] * m[..., 1, 0]
    return c
