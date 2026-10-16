"""Distillation: teacher samples -> Kelvinlet dictionary -> params field.js consumes.

Acceptance (P1-4 / work package): skin RMS <= 3% of the max teacher
displacement with <= 64 atoms per side, min det(I + sum w J) > 0.2 at every
slider extreme (validate.js fieldCheck grid, res 14), a synthetic analytic
target <= 3%, and a JS round trip within 1e-9 * S.
"""

import json

import numpy as np
import pytest
from scipy.spatial import cKDTree
from helpers import needs_changli, needs_node, synthetic_body, write_synthetic_bind

from bustfield import distill as D
from bustfield.field import DEFAULT_PARAMS, TARGETS, BustField, clone_params
from bustfield.jsbridge import compare_with_js
from bustfield.schema import validate
from bustfield.solve import solve_qp


def test_solve_qp_active_and_inactive():
    H = np.eye(2)
    x, lam = solve_qp(H, np.zeros(2), np.array([[1.0, 1.0]]), np.array([2.0]))
    assert np.allclose(x, [1, 1]) and lam[0] > 0
    x, lam = solve_qp(H, np.array([3.0, 3.0]), np.array([[1.0, 1.0]]), np.array([2.0]))
    assert np.allclose(x, [3, 3]) and np.all(lam == 0)
    # two constraints, one redundant
    x, _ = solve_qp(H, np.zeros(2), np.array([[1.0, 0.0], [2.0, 0.0]]), np.array([1.0, 1.0]))
    assert np.allclose(x, [1, 0], atol=1e-8)


@pytest.fixture(scope="module")
def synth(frame):
    params = clone_params(DEFAULT_PARAMS)
    V, N, tris = synthetic_body(frame, params)
    return params, V, N, tris


def test_make_samples_kinds(frame, synth):
    params, V, N, _ = synth
    field = BustField(frame, params)
    teacher = D.field_teacher(frame, params)
    s = D.make_samples(field, V, N, ["bust_lift_up"], teacher)
    assert set(np.unique(s.kind)) == {D.KIND_SKIN, D.KIND_INTERIOR, D.KIND_SHELL}
    skin = s.P[s.kind == D.KIND_SKIN]
    U = s.U["bust_lift_up"]
    # interior samples carry the teacher's own values
    Pi = s.P[s.kind == D.KIND_INTERIOR]
    assert np.allclose(U[s.kind == D.KIND_INTERIOR], teacher("bust_lift_up", Pi))
    # shell samples: skin displacement extrapolated (constant) along the normal,
    # 0.005..0.015 S outside the skin
    Ps, Us = s.P[s.kind == D.KIND_SHELL], U[s.kind == D.KIND_SHELL]
    dist, j = cKDTree(skin).query(Ps)
    assert np.all((dist > 0.004 * frame["S"]) & (dist < 0.016 * frame["S"]))
    assert np.allclose(Us, U[s.kind == D.KIND_SKIN][j])
    # every sample is inside the student's support
    assert np.all(field.weight(s.P) > 0)


@pytest.fixture(scope="module")
def self_distilled(frame, synth):
    params, V, N, _ = synth
    field = BustField(frame, params)
    samples = D.make_samples(field, V, N, TARGETS, D.field_teacher(frame, params))
    return D.fit_targets(frame, params, samples, TARGETS, D.Dictionary.lattice()), samples


def test_self_distillation_synthetic(frame, self_distilled):
    res, _ = self_distilled
    for t, st in res.skin.items():
        assert st["rel_rms"] <= 0.03, (t, st)
    assert max(res.atoms_per_side.values()) <= 64
    # the hand-tuned teacher itself folds below the gate on this rig
    # (min det ~0.09); the det-constrained student must pass
    teacher_gate = D.gate_check(frame, DEFAULT_PARAMS, (14,))[0]
    assert teacher_gate < 0.2
    assert res.gate["passed"] and res.gate["minDet"] > 0.2, res.gate
    assert res.gate["minDet_all_res"] > 0.2
    validate(res.params)
    # only the targets were replaced
    assert {k: v for k, v in res.params.items() if k != "targets"} == {k: v for k, v in DEFAULT_PARAMS.items() if k != "targets"}


def test_gate_repair_on_folding_teacher(frame, synth):
    """A teacher that folds space (min det < 0) still distills into an
    injective student: the linearized det constraints move the fit only where
    the skin does not pin it."""
    params, V, N, _ = synth
    ex = clone_params(params)
    for ops in ex["targets"].values():
        for op in ops:
            if "d" in op:
                op["d"] = [1.35 * v for v in op["d"]]
            if "k" in op:
                op["k"] *= 1.35
    assert D.gate_check(frame, ex, (14,))[0] < 0
    field = BustField(frame, params)
    samples = D.make_samples(field, V, N, TARGETS, D.field_teacher(frame, ex))
    res = D.fit_targets(frame, params, samples, TARGETS, D.Dictionary.lattice())
    first = res.history[0]["qp"][0]["minDet"]
    assert first < 0.2  # unconstrained least squares fails the gate
    assert res.gate["passed"], res.gate
    assert max(st["rel_rms"] for st in res.skin.values()) <= 0.03


def test_penalty_fallback_without_qp(frame, synth):
    """Spec fallback (no det constraints): ridge + Jacobian smoothing are raised
    until the gate passes. It gets there, but at a much larger fit error than
    the det-constrained QP (measured: ~4.9 % vs ~0.8 % on this rig), which is
    why the QP is the default."""
    params, V, N, _ = synth
    field = BustField(frame, params)
    samples = D.make_samples(field, V, N, TARGETS, D.field_teacher(frame, params))
    res = D.fit_targets(frame, params, samples, TARGETS, D.Dictionary.lattice(), max_qp_iter=0, max_retries=4)
    assert len(res.history) > 1 and res.history[-1]["jac"] > 0
    assert res.gate["passed"], res.gate


def test_synthetic_analytic_target(frame, synth, self_distilled):
    params, V, N, _ = synth
    base = self_distilled[0].params
    field = BustField(frame, base)
    t = ["bust_size_up_natural"]
    samples = D.make_samples(field, V, N, t, D.inflation_teacher(frame, base))
    res = D.fit_targets(frame, base, samples, t, D.Dictionary.lattice())
    assert res.skin[t[0]]["rel_rms"] <= 0.03, res.skin
    assert res.gate["passed"]


def test_prune_to_budget(frame, synth):
    params, V, N, _ = synth
    field = BustField(frame, params)
    t = ["bust_size_up_stylized", "bust_lift_up"]
    samples = D.make_samples(field, V, N, t, D.field_teacher(frame, params))
    dic = D.prune(frame, params, samples, t, D.Dictionary.lattice(), 20)
    assert len(dic) <= 20
    res = D.fit_targets(frame, params, samples, t, dic)
    assert max(res.atoms_per_side.values()) <= 20
    assert max(st["rel_rms"] for st in res.skin.values()) <= 0.05


@needs_node
def test_round_trip_through_field_js(frame, self_distilled):
    res, samples = self_distilled
    skin = samples.P[samples.kind == D.KIND_SKIN]
    err = compare_with_js(frame, res.params, skin[:: max(1, len(skin) // 300)])
    assert err["delta"] < 1e-9 * err["S"] and err["jacobian"] < 1e-9 * err["S"], err


def test_cli_on_synthetic_bind(tmp_path, frame, synth, capsys):
    params, V, N, tris = synth
    bind = tmp_path / "synth.bind.json"
    write_synthetic_bind(bind, frame, params, V, N, tris)
    out, rep = tmp_path / "p.json", tmp_path / "r.json"
    # partial distill on top of the hand-tuned params: the gate is a property of
    # the whole param set, and the untouched targets fail it on this rig
    code = D.main(["--bind", str(bind), "--skin", "*", "--targets", "bust_lift_up", "--out", str(out)])
    assert code == 1 and "NOT distilled here" in capsys.readouterr().out
    # all targets: passes
    code = D.main(["--bind", str(bind), "--skin", "*", "--out", str(out), "--report", str(rep)])
    assert code == 0
    p = json.loads(out.read_text())
    validate(p)
    r = json.loads(rep.read_text())
    assert r["gate"]["passed"] and all(v["rel_rms"] <= 0.03 for v in r["skin"].values())
    # samples-file teacher (e.g. an FEM bake) on top of the distilled params
    field = BustField(frame, params)
    s = D.make_samples(field, V, N, ["bust_lift_up"], D.field_teacher(frame, params))
    s.save(tmp_path / "s.npz")
    out2 = tmp_path / "p2.json"
    code = D.main(["--bind", str(bind), "--params", str(out), "--teacher", f"samples:{tmp_path / 's.npz'}", "--out", str(out2)])
    assert code == 0
    assert json.loads(out2.read_text())["targets"]["bust_spread_in"] == p["targets"]["bust_spread_in"]


# --- Changli (private test asset; skipped when absent) -------------------------


@pytest.fixture(scope="module")
def changli_self(changli):
    base = changli.params
    field = BustField(changli.frame, base)
    P, N = changli.select(["UP_Skin", "UP*"])
    samples = D.make_samples(field, P, N, TARGETS, D.field_teacher(changli.frame, base))
    return D.fit_targets(changli.frame, base, samples, TARGETS, D.Dictionary.lattice()), samples


@needs_changli
def test_changli_self_distillation(changli_self):
    res, samples = changli_self
    assert res.n_samples["skin"] > 2000
    for t, st in res.skin.items():
        assert st["rel_rms"] <= 0.03, (t, st)
    assert max(res.atoms_per_side.values()) <= 64
    assert res.gate["passed"] and res.gate["minDet"] > 0.2


@needs_changli
@needs_node
def test_changli_round_trip(changli, changli_self):
    res, samples = changli_self
    skin = samples.P[samples.kind == D.KIND_SKIN]
    err = compare_with_js(changli.frame, res.params, skin[:: max(1, len(skin) // 300)])
    assert err["delta"] < 1e-9 * err["S"] and err["jacobian"] < 1e-9 * err["S"], err


@needs_changli
def test_changli_synthetic_target(changli, changli_self):
    base = changli_self[0].params
    field = BustField(changli.frame, base)
    P, N = changli.select(["UP_Skin", "UP*"])
    t = ["bust_size_up_natural"]
    samples = D.make_samples(field, P, N, t, D.inflation_teacher(changli.frame, base))
    res = D.fit_targets(changli.frame, base, samples, t, D.Dictionary.lattice())
    assert res.skin[t[0]]["rel_rms"] <= 0.03, res.skin
    assert res.gate["passed"]


def test_samples_load_reads_teacher_format(tmp_path):
    # tools/teacher writes one target per file under 'U' (+ 'U_body' in body/S units);
    # 'U_body' must not be mistaken for a target named 'body'.
    import numpy as np
    from bustfield.distill import Samples

    P = np.random.default_rng(0).normal(size=(5, 3))
    U = np.random.default_rng(1).normal(size=(5, 3))
    f = tmp_path / "bust_lift_up.npz"
    np.savez(f, format="bust-teacher/1", target="bust_lift_up", P=P, U=U, U_body=U * 2,
             w=np.ones(5), kind=np.zeros(5, np.uint8))
    s = Samples.load(str(f))
    assert list(s.U) == ["bust_lift_up"]
    assert np.array_equal(s.U["bust_lift_up"], U)
