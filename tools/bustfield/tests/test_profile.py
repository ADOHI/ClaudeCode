"""Artist profile-curve inverse fit (sagittal profile -> dictionary amplitudes)."""

import json

import numpy as np
import pytest
from helpers import needs_changli, synthetic_body, synthetic_torso, write_synthetic_bind

from bustfield import profile_fit as PF
from bustfield.field import DEFAULT_PARAMS, BustField, clone_params, from_body, to_body
from bustfield.schema import validate


@pytest.fixture(scope="module")
def synth(frame):
    params = clone_params(DEFAULT_PARAMS)
    V, N, tris = synthetic_body(frame, params, res=0.01)
    return params, V, N, tris


def test_sagittal_envelope_matches_surface(frame, synth):
    params, V, _, tris = synth
    a = params["anchor"]
    ys = a["y"] + np.linspace(-0.3, 0.3, 31)
    prof = PF.sagittal_profile(frame, V, tris, a["x"] + 0.003, ys)
    x = a["x"] + 0.003
    expect = a["z"] + sum(
        params["depth"] * np.exp(-((x - s * a["x"]) ** 2 + (ys - a["y"]) ** 2) / (2 * 0.1**2)) for s in (1, -1)
    )
    # piecewise-linear mesh with 0.01 S cells: chord error of the Gaussian mound
    assert np.nanmax(np.abs(prof.zs - expect)) < 2e-3


def test_rounder_target_shape():
    ys = np.linspace(-0.3, 0.35, 66)
    zs = 0.2 * np.exp(-(ys**2) / (2 * 0.1**2)) - 0.2
    tg, info = PF.rounder_target(PF.Profile(0.25, ys, zs), -0.25, 0.3, projection=1.1, roundness=0.15)
    out = (ys <= -0.25) | (ys >= 0.3)
    assert np.allclose(tg.zs[out], zs[out])
    ia = np.argmin(np.abs(ys - info["apex_y"]))
    base_a = zs[ia] - info["h_apex"]
    assert abs((tg.zs[ia] - base_a) - 1.1 * info["h_apex"]) < 1e-12
    up = (ys > info["apex_y"]) & (ys < 0.3)
    assert np.all(tg.zs[up] >= zs[up])  # fuller upper pole
    mid = np.argmin(np.abs(ys - (info["apex_y"] + 0.3) / 2))
    assert tg.zs[mid] - zs[mid] > 0.15 * info["h_apex"]


def test_profile_error_zero_on_target():
    ys = np.linspace(0, 1, 11)
    p = PF.Profile(0, ys, ys**2)
    assert np.allclose(PF.profile_error(p, p), 0)
    q = PF.Profile(0, ys, ys**2 + 0.01)
    d = PF.profile_error(q, p)
    assert np.all(d <= 0.01 + 1e-12) and d.max() > 0.005


def _args(**kw):
    a = dict(target="bust_size_up_stylized", layers="*", curve=None, projection=1.1, roundness=0.15, y_lower=-0.2, y_upper=0.25, smooth=1e-3, verbose=False)
    a.update(kw)
    return type("A", (), a)()


def test_profile_fit_synthetic(tmp_path, frame, synth):
    params, V, N, tris = synth
    path = tmp_path / "synth.bind.json"
    write_synthetic_bind(path, frame, params, V, N, tris)
    from bustfield.bind import Bind

    rep = PF.run(frame, params, Bind.load(path), _args())
    e = rep["error"]
    assert e["after_rms"] < 0.1 * e["before_rms"], e
    assert e["after_rms_rel"] < 0.02, e
    # combos with the fitted target pass; the hand-tuned DEFAULT_PARAMS other
    # targets fail the gate on this rig by themselves (see test_distill)
    assert rep["gate"]["minDet_movable"] > 0.2, rep["gate"]
    assert rep["atoms_per_side"] <= 64
    validate(rep["params"])
    # only the fitted target changed
    p = rep["params"]
    for t, ops in DEFAULT_PARAMS["targets"].items():
        if t != "bust_size_up_stylized":
            assert p["targets"][t] == ops
    # the edit is local: zero outside the window, symmetric left / right
    f = BustField(frame, p)
    rot = {**frame, "origin": [0, 0, 0]}
    S = frame["S"]
    for b in ([0.2, 0.1, 0.4], [0.3, -0.05, 0.35]):
        dL = to_body(rot, f.delta("bust_size_up_stylized", from_body(frame, [b[0] * S, b[1] * S, b[2] * S])))
        dR = to_body(rot, f.delta("bust_size_up_stylized", from_body(frame, [-b[0] * S, b[1] * S, b[2] * S])))
        assert np.allclose(dL, [-dR[0], dR[1], dR[2]], atol=1e-12)


def test_profile_fit_custom_curve_cli(tmp_path, frame, synth):
    """--curve: an explicit polyline (apex-relative S units) is fitted as given."""
    params, V, N, tris = synth
    path = tmp_path / "synth.bind.json"
    write_synthetic_bind(path, frame, params, V, N, tris)
    ys = np.arange(-0.28, 0.33, 0.01)
    # rest profile of the mound (apex at 0) pushed forward by a smooth bump
    zs = params["depth"] * (np.exp(-(ys**2) / (2 * 0.1**2)) - 1) + 0.03 * np.exp(-((ys - 0.05) ** 2) / (2 * 0.08**2))
    curve = tmp_path / "curve.json"
    curve.write_text(json.dumps({"ys": ys.tolist(), "zs": zs.tolist()}))
    out, rep = tmp_path / "p.json", tmp_path / "r.json"
    PF.main(["--bind", str(path), "--layers", "*", "--curve", str(curve), "--y-lower", "-0.2", "--y-upper", "0.24", "--out", str(out), "--report", str(rep)])
    r = json.loads(rep.read_text())
    assert r["error"]["after_rms"] < 0.25 * r["error"]["before_rms"], r["error"]
    validate(json.loads(out.read_text()))


@needs_changli
def test_profile_fit_changli(changli):
    """Demo: 'rounder upper pole, +10% projection' on the Changli bind export."""
    rep = PF.run(changli.frame, changli.params, changli, _args(layers="UP_Skin,UP*", y_lower=-0.26, y_upper=0.3))
    e = rep["error"]
    print("changli profile fit:", json.dumps(e))
    assert e["after_rms"] < 0.1 * e["before_rms"], e
    assert e["after_rms_rel"] < 0.02
    assert rep["gate"]["minDet"] > 0.2


def test_frontal_silhouette_fit(tmp_path, frame):
    """Optional frontal silhouette: widen the front-view contour of the mound
    while the sagittal profile follows its own target."""
    from bustfield.bind import Bind

    params = clone_params(DEFAULT_PARAMS)
    V, N, tris = synthetic_torso(frame, params, res=0.01, rx=0.38, rz=0.15)
    path = tmp_path / "synth.bind.json"
    write_synthetic_bind(path, frame, params, V, N, tris)
    S = frame["S"]
    f = BustField(frame, params)
    apex = np.asarray(to_body(frame, f.sides[0].apex)) / S
    ys_rel = np.round(np.arange(-0.14, 0.14 + 1e-9, 0.01), 6)
    inside = tris[(f.weight(V)[tris] > 0).all(axis=1)]
    rest = PF.frontal_silhouette(frame, V, inside, 1, apex[1] + ys_rel)
    assert np.all(np.isfinite(rest))
    # the contour is the torso side bulged by the mound (an occluding contour)
    assert np.all(rest[:, 0] > 0.38) and np.all(rest[:, 2] < apex[2] - 0.1)
    xs = rest[:, 0] - apex[0] + 0.012 * np.exp(-((ys_rel / 0.07) ** 2))
    fr = tmp_path / "frontal.json"
    fr.write_text(json.dumps({"ys": ys_rel.tolist(), "xs": xs.tolist()}))
    rep = PF.run(frame, params, Bind.load(path), _args(frontal=str(fr), frontal_weight=1.0))
    e = rep["error"]
    print("frontal fit:", json.dumps(e))
    assert e["frontal"]["after_rms"] < 0.35 * e["frontal"]["before_rms"], e
    assert e["after_rms"] < 0.15 * e["before_rms"], e
    assert rep["gate"]["minDet_movable"] > 0.2
