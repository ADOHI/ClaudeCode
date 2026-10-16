"""Parity of the Python field with web/src/core/field.js (via web/scripts/eval-field.mjs).

Requirement: max abs difference < 1e-9 * S for displacements and Jacobians
(Jacobians are dimensionless; the same bound is used) on ~300 points in and
around both windows, for every target.
"""

import numpy as np
import pytest
from helpers import JOINTS, needs_changli, needs_node, random_params, rotated_joints, window_points

from bustfield.field import DEFAULT_PARAMS, BustField, build_body_frame, clone_params, from_body, slider_to_weights, to_body
from bustfield.jsbridge import compare_with_js, eval_js
from bustfield.validate import extreme_combos, field_check

pytestmark = needs_node


def _variant(name):
    p = clone_params(DEFAULT_PARAMS)
    if name == "smooth":
        p["kernel"] = "smooth"
    elif name == "random":
        p = random_params(1)
    elif name == "random-smooth":
        p = random_params(2)
        p["kernel"] = "smooth"
    elif name == "edges":
        # no midline band / lock, hard plateau edges, asymmetric window
        p["midline"] = 0
        p["midlineLock"] = 0
        p["window"].update(hardness=0.0, hardnessZ=0.0, yUp=0.3)
    elif name == "wide-lock":
        p["midline"] = 0.2
        p["midlineLock"] = 0.3
        p["anchor"] = {"x": 0.2, "y": -0.1, "z": 0.1}
    return p


def test_default_params_match_js():
    js = eval_js({})
    assert js["defaultParams"] == DEFAULT_PARAMS


@pytest.mark.parametrize("joints", [JOINTS, rotated_joints()], ids=["synthetic", "rotated-scaled"])
def test_body_frame_parity(joints):
    js = eval_js({"joints": joints, "body": [[0.1, 0.2, 0.3], [-1, 2, 0.5]]})
    py = build_body_frame(**joints)
    S = py["S"]
    for k in ("origin", "left", "up", "forward"):
        assert np.abs(np.array(py[k]) - js["frame"][k]).max() < 1e-12 * max(1, S), k
    for k in ("S", "hipsY", "neckY"):
        assert abs(py[k] - js["frame"][k]) < 1e-12 * max(1, S), k
    pts = np.array([[0.1, 0.2, 0.3], [-1, 2, 0.5]])
    assert np.abs(np.asarray(to_body(py, pts)) - js["toBody"]).max() < 1e-12 * max(1, S)
    assert np.abs(np.asarray(from_body(py, pts)) - js["fromBody"]).max() < 1e-12 * max(1, S)


def test_slider_to_weights_parity():
    rng = np.random.default_rng(3)
    sliders = [dict(size=float(a), style=float(b), lift=float(c), spread=float(d)) for a, b, c, d in rng.uniform(-1.5, 1.5, (40, 4))]
    sliders += extreme_combos()
    js = eval_js({"sliders": sliders})
    for s, w in zip(sliders, js["sliders"]):
        assert slider_to_weights(**s) == w


@pytest.mark.parametrize("variant", ["default", "smooth", "random", "random-smooth", "edges", "wide-lock"])
@pytest.mark.parametrize("joints", [JOINTS, rotated_joints()], ids=["synthetic", "rotated-scaled"])
def test_field_parity(joints, variant):
    frame = build_body_frame(**joints)
    params = _variant(variant)
    field = BustField(frame, params)
    P = window_points(field, 300, seed=sum(map(ord, variant)))
    # the samples must actually exercise the support, not just empty space
    assert (field.weight(P) > 0).mean() > 0.3
    err = compare_with_js(frame, params, P)
    S = err["S"]
    assert err["delta"] < 1e-9 * S, err
    assert err["jacobian"] < 1e-9 * S, err
    assert err["weight"] < 1e-12, err


@needs_changli
def test_field_parity_changli(changli):
    field = BustField(changli.frame, changli.params)
    P = window_points(field, 300, seed=7)
    err = compare_with_js(changli.frame, changli.params, P)
    assert err["delta"] < 1e-9 * err["S"] and err["jacobian"] < 1e-9 * err["S"], err


@pytest.mark.parametrize("joints", [JOINTS, rotated_joints()], ids=["synthetic", "rotated-scaled"])
def test_field_check_parity(joints):
    """The Python injectivity gate reproduces validate.js fieldCheck."""
    frame = build_body_frame(**joints)
    js = eval_js({"frame": frame, "check": {"res": 10}})["check"]
    py = field_check(BustField(frame), 10)
    assert py["samples"] == js["samples"]
    assert abs(py["minDet"] - js["minDet"]) < 1e-9
    assert py["minCombo"] == js["minCombo"]
    for t, v in js["volume"].items():
        assert abs(py["volume"][t]["meanChange"] - v["meanChange"]) < 1e-9
        assert abs(py["volume"][t]["maxAbsChange"] - v["maxAbsChange"]) < 1e-9


def test_single_point_api(frame):
    f = BustField(frame)
    p = f.sides[0].apex
    d = f.delta("bust_lift_up", p)
    assert np.asarray(d).shape == (3,)
    assert f.jacobian("bust_lift_up", p).shape == (3, 3)
    js = eval_js({"frame": frame, "points": [p], "targets": ["bust_lift_up"]})
    assert np.abs(np.asarray(d) - js["delta"]["bust_lift_up"][0]).max() < 1e-12

