"""Shared test helpers (imported by the test modules; conftest.py puts tools/ on sys.path)."""

import base64
import json
import math
import pathlib
import sys

import numpy as np
import pytest

TOOLS = pathlib.Path(__file__).resolve().parents[2]
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from bustfield.field import DEFAULT_PARAMS, clone_params, from_body  # noqa: E402
from bustfield.jsbridge import node_available  # noqa: E402

REPO = TOOLS.parent
CHANGLI = REPO / "web" / ".cache" / "changli.bind.json"

# Same synthetic rig as web/test/core.test.js.
JOINTS = {
    "hips": [0, -1.2, 0],
    "chest": [0, 0, -0.05],
    "neck": [0, 0.5, -0.05],
    "leftUpperArm": [0.5, 0.35, -0.05],
    "rightUpperArm": [-0.5, 0.35, -0.05],
}


def rotated_joints(scale=2.57, angle=0.7, offset=(3.0, 15.0, -1.0)):
    """The synthetic rig under a rotation about a tilted axis, scaled and moved:
    the field must not depend on world orientation or units."""
    axis = np.array([0.3, 1.0, 0.2])
    axis /= np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    R = np.eye(3) + math.sin(angle) * K + (1 - math.cos(angle)) * K @ K
    return {k: (R @ (np.array(v) * scale) + offset).tolist() for k, v in JOINTS.items()}


needs_node = pytest.mark.skipif(not node_available(), reason="node / web/scripts/eval-field.mjs not available")
needs_changli = pytest.mark.skipif(not CHANGLI.exists(), reason="web/.cache/changli.bind.json not present (private test asset)")


def window_points(field, n=300, seed=0, grow=1.15):
    """Random bind-space points in and around both windows plus the midline band."""
    rng = np.random.default_rng(seed)
    R = field.R
    lo = np.array([-R["x"], -R["yDown"], -R["zBack"]]) * grow
    hi = np.array([R["x"], R["yUp"], R["zFront"]]) * grow
    pts = []
    n_side = (n - n // 10) // 2
    for side in field.sides:
        Q = rng.uniform(lo, hi, size=(n_side, 3))
        pts.append(np.asarray(side.base) + field.from_side_vec(side, Q))
    # midline band (partition of unity + lateral lock)
    m = n - 2 * n_side
    S = field.S
    a = field.params["anchor"]
    b = np.stack([rng.uniform(-0.2, 0.2, m), a["y"] + rng.uniform(-0.3, 0.3, m), a["z"] + rng.uniform(-0.1, 0.4, m)], axis=-1) * S
    pts.append(np.asarray(from_body(field.frame, b)))
    return np.concatenate(pts)


def random_params(seed=1, n_ops=3):
    """DEFAULT_PARAMS shape with random brushes (both kinds, nu incl. 0 and 0.5)."""
    rng = np.random.default_rng(seed)
    p = clone_params(DEFAULT_PARAMS)
    for t in p["targets"]:
        ops = []
        for _ in range(n_ops):
            at = rng.uniform(-0.2, 0.2, 3).round(4).tolist()
            nu = float(rng.choice([0.0, 0.2, 0.45, 0.5]))
            r = round(float(rng.uniform(0.05, 0.3)), 4)
            if rng.random() < 0.5:
                ops.append({"type": "grab", "at": at, "d": rng.normal(0, 0.03, 3).round(5).tolist(), "radius": r, "nu": nu})
            else:
                ops.append({"type": "scale", "at": at, "k": float(rng.normal(0, 0.4)), "radius": r, "nu": nu})
        p["targets"][t] = ops
    return p


def synthetic_body(frame, params, res=0.02, sigma=0.1, curve=0.0):
    """Height-field chest with two Gaussian mounds at the anchors (body frame,
    S units): a stand-in skin for tests that must not depend on model files.
    `curve` bends the chest back laterally (z -= curve * x^2) so the mounds
    have a front-view contour. Returns bind-space (V, N, tris)."""
    S = frame["S"]
    a = params["anchor"]
    xs = np.arange(-0.6, 0.6 + 1e-9, res)
    ys = np.arange(a["y"] - 0.5, a["y"] + 0.5 + 1e-9, res)
    X, Y = np.meshgrid(xs, ys, indexing="ij")

    def z(X, Y):
        h = -curve * X**2
        for s in (1, -1):
            h += params["depth"] * np.exp(-((X - s * a["x"]) ** 2 + (Y - a["y"]) ** 2) / (2 * sigma**2))
        return a["z"] + h

    Z = z(X, Y)
    e = 1e-5
    dzdx = (z(X + e, Y) - z(X - e, Y)) / (2 * e)
    dzdy = (z(X, Y + e) - z(X, Y - e)) / (2 * e)
    Nb = np.stack([-dzdx, -dzdy, np.ones_like(Z)], axis=-1)
    Nb /= np.linalg.norm(Nb, axis=-1, keepdims=True)
    B = np.stack([X, Y, Z], axis=-1).reshape(-1, 3) * S
    V = np.asarray(from_body(frame, B))
    Nw = Nb.reshape(-1, 3)
    L, U, F = (np.asarray(frame[k]) for k in ("left", "up", "forward"))
    N = Nw[:, :1] * L + Nw[:, 1:2] * U + Nw[:, 2:] * F
    nx, ny = X.shape
    idx = np.arange(nx * ny).reshape(nx, ny)
    a0, b0, c0, d0 = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()
    tris = np.concatenate([np.stack([a0, b0, c0], -1), np.stack([a0, c0, d0], -1)])
    return V, N, tris


def synthetic_torso(frame, params, res=0.02, sigma=0.1, rx=0.4, rz=0.25):
    """Elliptic-cylinder torso (half axes rx, rz; front at z = anchor.z) with
    the two Gaussian mounds pushed out along the normal. Unlike the height
    field it has real sides, i.e. a front-view occluding contour.
    Returns bind-space (V, N, tris)."""
    S = frame["S"]
    a = params["anchor"]
    zc = a["z"] - rz
    th = np.arange(-2.3, 2.3 + 1e-9, res / rx)
    ys = np.arange(a["y"] - 0.5, a["y"] + 0.5 + 1e-9, res)
    T, Y = np.meshgrid(th, ys, indexing="ij")

    def surf(T, Y):
        x, z = rx * np.sin(T), zc + rz * np.cos(T)
        nx, nz = np.sin(T) / rx, np.cos(T) / rz
        nl = np.hypot(nx, nz)
        m = sum(params["depth"] * np.exp(-((x - s * a["x"]) ** 2 + (Y - a["y"]) ** 2) / (2 * sigma**2)) for s in (1, -1))
        return np.stack([x + m * nx / nl, Y, z + m * nz / nl], axis=-1)

    Bp = surf(T, Y)
    e = 1e-5
    dt = (surf(T + e, Y) - surf(T - e, Y)) / (2 * e)
    dy = (surf(T, Y + e) - surf(T, Y - e)) / (2 * e)
    Nb = np.cross(dt, dy)  # outward: d/dtheta x d/dy
    Nb /= np.linalg.norm(Nb, axis=-1, keepdims=True)
    V = np.asarray(from_body(frame, Bp.reshape(-1, 3) * S))
    Nw = Nb.reshape(-1, 3)
    L, U, F = (np.asarray(frame[k]) for k in ("left", "up", "forward"))
    N = Nw[:, :1] * L + Nw[:, 1:2] * U + Nw[:, 2:] * F
    nt, ny = T.shape
    idx = np.arange(nt * ny).reshape(nt, ny)
    a0, b0, c0, d0 = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()
    tris = np.concatenate([np.stack([a0, b0, c0], -1), np.stack([a0, c0, d0], -1)])
    return V, N, tris


def write_synthetic_bind(path, frame, params, V, N, tris, material="Skin"):
    """Write a bust-bind/1 file (same layout as rig.js exportBind) for a mesh."""

    def b64(a, dt):
        return base64.b64encode(np.ascontiguousarray(a, dtype=dt).tobytes()).decode()

    idx = np.asarray(tris).reshape(-1)
    data = {
        "format": "bust-bind/1",
        "frame": frame,
        "params": params,
        "bones": {},
        "bonePositions": {},
        "meshes": [
            {
                "name": "synthetic",
                "vertexCount": int(len(V)),
                "positions": b64(V, "<f4"),
                "normals": b64(N, "<f4"),
                "index": b64(idx, "<u4"),
                "mask": None,
                "bindMatrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                "groups": [{"start": 0, "count": int(len(idx)), "material": material}],
            }
        ],
    }
    with open(path, "w") as f:
        json.dump(data, f)

