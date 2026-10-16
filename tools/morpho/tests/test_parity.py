"""JS (web/src/core/morpho.js) vs Python (morpho.py) on identical inputs."""

import math

import numpy as np
import pytest
from conftest import CHANGLI

from morpho.jsbridge import ctx_from_js, node_available, run_js
from morpho.morpho import METRICS, measure_prepared, prepare_morpho
from morpho.synth_torso import synth_torso

pytestmark = pytest.mark.skipif(not node_available(), reason="node not available")

KEYS = [k for k, *_ in METRICS] + ["upperPoleH", "lowerPoleH", "apexY", "nippleY", "imfDrop", "imfFrac"]
POINTS = ["apex", "nipple", "top", "bottom", "imf", "medial", "lateral"]
TOL = 1e-8


def _close(a, b, tol=TOL):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def compare(js: dict, py: dict, label: str):
    """Every metric, landmark and flag of both sides and the mean."""
    worst = 0.0
    for sj, sp in zip(js["sides"], py["sides"]):
        assert sj["flags"] == sp["flags"], f"{label} {sj['side']}: {sj['flags']} vs {sp['flags']}"
        assert sj["ok"] == sp["ok"], label
        for k in KEYS:
            a, b = sj.get(k), sp.get(k)
            if isinstance(b, float) and math.isnan(b):
                b = None
            assert _close(a, b), f"{label} {sj['side']} {k}: js {a} py {b}"
            if a is not None:
                worst = max(worst, abs(a - b))
        for k in POINTS:
            a, b = sj.get(k), sp.get(k)
            assert (a is None) == (b is None), f"{label} {k}"
            if a is not None:
                for x, y in zip(a, b):
                    assert _close(x, y), f"{label} {sj['side']} {k}: js {a} py {b}"
        for k in ("upperShape", "lowerShape"):
            assert sj.get(k) == sp.get(k), f"{label} {k}"
    for k in KEYS:
        if k in js["mean"]:
            assert _close(js["mean"][k], py["mean"].get(k)), f"{label} mean {k}"
    return worst


SHAPES = {
    "round": {},
    "full lower pole": {"bUp": 0.12, "bLo": 0.19},
    "lateral heavy, jittered": {"aLat": 0.19, "aMed": 0.12, "jitter": 0.6},
    "coarse h=0.04": {"h": 0.04},
    "flat chest (flagged)": {"P": 0.01},
}


@pytest.mark.parametrize("name", list(SHAPES))
def test_synthetic_parity(name):
    s = synth_torso(**SHAPES[name])
    pos = s["pos"]
    # a smooth lift-and-grow delta so the weights path is exercised too
    d = np.zeros_like(pos)
    g = np.exp(-((np.abs(pos[:, 0]) - 0.27) ** 2 + (pos[:, 1] - 0.27) ** 2) / 0.02)
    d[:, 1] = 0.04 * g
    d[:, 2] = 0.03 * g
    meshes = [{"pos": pos, "tris": s["index"], "deltas": {"grow": d}}]
    states = [None, {"grow": 0.5}, {"grow": 1.0}]
    js = run_js({"frame": s["frame"], "meshes": meshes, "apex": s["apex"], "states": states})["results"]
    ctx = prepare_morpho(s["frame"], meshes, s["apex"])
    worst = max(compare(rj, measure_prepared(ctx, st), f"{name} {st}") for st, rj in zip(states, js))
    print(f"parity {name}: max |js - py| = {worst:.2e}")


def test_transformed_frame_parity():
    """Non-trivial body frame and scale (MMD-like units)."""
    s = synth_torso(bUp=0.13, bLo=0.17)
    th = math.radians(6)
    R = np.array([[1, 0, 0], [0, math.cos(th), -math.sin(th)], [0, math.sin(th), math.cos(th)]])
    sc, t = 2.57, np.array([0.0, 15.57, -0.06])
    pos = (s["pos"] @ R.T) * sc + t
    frame = {"origin": t.tolist(), "left": R[:, 0].tolist(), "up": R[:, 1].tolist(), "forward": R[:, 2].tolist(), "S": sc, "hipsY": -2.68, "neckY": 2.58}
    apex = [((np.array(a) @ R.T) * sc + t).tolist() for a in s["apex"]]
    meshes = [{"pos": pos, "tris": s["index"], "mask": np.ones(len(pos))}]
    js = run_js({"frame": frame, "meshes": meshes, "apex": apex, "shoulderY": 0.85, "states": [None]})["results"][0]
    py = measure_prepared(prepare_morpho(frame, meshes, apex, shoulder_y=0.85))
    compare(js, py, "transformed")
    assert py["sides"][0]["imfDrop"] is not None


@pytest.mark.skipif(not CHANGLI.exists(), reason="changli bind export not present (private test model)")
def test_changli_parity():
    """Real mesh, all six report states: JS bakes the field (DEFAULT_PARAMS +
    auto-fit) and dumps its prepared context; Python measures that context."""
    states = ["base", "size_up_natural", "size_up_stylized", "size_down", "lift_up", "lift_down"]
    out = run_js({"bind": str(CHANGLI), "selection": "outer", "states": states, "dumpCtx": True}, timeout=600)
    ctx = ctx_from_js(out["ctx"])
    worst = max(compare(rj, measure_prepared(ctx, w), f"changli {name}") for name, w, rj in zip(states, out["ctx"]["weights"], out["results"]))
    print(f"parity changli (6 states): max |js - py| = {worst:.2e}")
