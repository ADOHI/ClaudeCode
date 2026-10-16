"""Analytic torso with two breast mounds: port of synth-torso.mjs (same
surface, same tessellation, same jitter sequence) for the Python tests."""

from __future__ import annotations

import math

import numpy as np

SYNTH_DEFAULTS = {
    "x": (-0.65, 0.65),
    "y": (-0.4, 0.95),
    "h": 0.02,
    "jitter": 0,
    "seed": 1,
    "type": "cap",
    "xc": 0.27,
    "yc": 0.27,
    "P": 0.14,
    "aLat": 0.15,
    "aMed": 0.14,
    "bUp": 0.15,
    "bLo": 0.16,
    "R": 1.4,
    "k": 0.02,
    "upper": "convex",
    "flatChest": False,
}

SYNTH_FRAME = {"origin": [0, 0, 0], "left": [1, 0, 0], "up": [0, 1, 0], "forward": [0, 0, 1], "S": 1, "hipsY": -1, "neckY": 1}


def chest_z(x, y):
    t = np.maximum(0, y - 0.45)
    return 0.18 - 0.6 * x * x - 0.08 * (y - 0.2) * (y - 0.2) - 0.25 * t * t


def _cap(r, R):
    s1 = math.sqrt(R * R - 1)
    top = R - s1
    inside = (np.sqrt(np.maximum(R * R - r * r, 0)) - s1) / top
    outside = (-(r - 1)) / (s1 * top)
    return np.where(r <= 1, inside, outside)


def _softplus(v, k):
    return np.where(v > 0, v + k * np.log1p(np.exp(-np.abs(v) / k)), k * np.log1p(np.exp(-np.abs(v) / k)))


def _mound_cap(x, y, m, side):
    dx, dy = side * x - m["xc"], y - m["yc"]
    a = np.where(dx >= 0, m["aLat"], m["aMed"])
    b = np.where(dy >= 0, m["bUp"], m["bLo"])
    r = np.sqrt((dx / a) ** 2 + (dy / b) ** 2)
    return m["P"] * _cap(r, m["R"])


def surface_z(x, y, m):
    if m["type"] != "cap":
        raise NotImplementedError("only the 'cap' mound is ported")
    c = np.full_like(x, 0.18) if m["flatChest"] else chest_z(x, y)
    v = np.maximum(_mound_cap(x, y, m, 1), _mound_cap(x, y, m, -1))
    return c + _softplus(v, m["k"])


def _rng(seed):
    s = (seed & 0xFFFFFFFF) or 1

    def nxt():
        nonlocal s
        s = (s ^ (s << 13)) & 0xFFFFFFFF
        s ^= s >> 17
        s = (s ^ (s << 5)) & 0xFFFFFFFF
        return s / 4294967296 - 0.5

    return nxt


def synth_torso(**opts):
    m = {**SYNTH_DEFAULTS, **opts}
    h = m["h"]
    nx = round((m["x"][1] - m["x"][0]) / h) + 1
    ny = round((m["y"][1] - m["y"][0]) / h) + 1
    X = np.empty((ny, nx))
    Y = np.empty((ny, nx))
    rnd = _rng(m["seed"])
    for j in range(ny):
        for i in range(nx):
            x, y = m["x"][0] + i * h, m["y"][0] + j * h
            if m["jitter"] and 0 < i < nx - 1 and 0 < j < ny - 1:
                x += rnd() * m["jitter"] * h
                y += rnd() * m["jitter"] * h
            X[j, i], Y[j, i] = x, y
    Z = surface_z(X, Y, m)
    pos = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    idx = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            b, c = a + 1, a + nx
            d = c + 1
            if (i + j) % 2 == 0:
                idx += [a, b, d, a, d, c]
            else:
                idx += [a, b, c, b, d, c]
    apex = [[m["xc"], m["yc"], 0.3], [-m["xc"], m["yc"], 0.3]]
    return {"pos": pos, "index": np.asarray(idx, dtype=np.int64), "frame": SYNTH_FRAME, "params": m, "apex": apex}
