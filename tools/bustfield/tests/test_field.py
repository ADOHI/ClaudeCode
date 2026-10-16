"""Invariants of the Python port that do not need node (mirrors web/test/core.test.js)
plus the linear structure distillation relies on."""

import numpy as np
from helpers import random_params

from bustfield import kelvinlet as kv
from bustfield.distill import Dictionary, design, jacobian_columns
from bustfield.field import DEFAULT_PARAMS, BustField, clone_params, from_body, params_with_targets, to_body
from bustfield.validate import extreme_combos, field_check


def divergence(fn, p, h=1e-4):
    s = 0.0
    for j in range(3):
        a, b = np.array(p, float), np.array(p, float)
        a[j] += h
        b[j] -= h
        s += (fn(a)[j] - fn(b)[j]) / (2 * h)
    return s


def test_grab_hits_displacement_at_centre():
    assert np.allclose(kv.grab(np.zeros(3), [0.1, -0.2, 0.3], 0.5, 0.45), [0.1, -0.2, 0.3], atol=1e-12)


def test_grab_divergence_free_at_half():
    for p in ([0.3, 0.2, 0.1], [1, 0.5, -0.3], [2, 1, 1]):
        assert abs(divergence(lambda q: kv.grab(q, [0, 1, 0], 1, 0.5), p)) < 1e-6


def test_triscale_is_local():
    assert abs(kv.grab(np.array([0, 4.0, 0]), [0, 1, 0], 1, 0.45)[1]) < 0.02
    assert abs(kv.scale_brush(np.array([4.0, 0, 0]), 0.3, 1, 0.2)[0]) < 0.02 * 4 * 0.3


def test_scale_rate_at_centre_and_zero_at_half():
    u = kv.scale_brush(np.array([1e-4, 0, 0]), 0.3, 1, 0.2)
    assert abs(u[0] / 1e-4 - 0.3) < 1e-3
    assert np.all(kv.scale_brush(np.array([[0.3, 0.1, 0]]), 0.3, 1, 0.5) == 0)


def test_bases_are_linear_maps_of_the_brushes():
    rng = np.random.default_rng(0)
    r = rng.normal(0, 0.3, (50, 3))
    d = rng.normal(0, 0.1, 3)
    for nu in (0.0, 0.2, 0.45, 0.5):
        assert np.allclose(kv.grab_basis(r, 0.2, nu) @ d, kv.grab(r, d, 0.2, nu), atol=1e-15)
        assert np.allclose(0.7 * kv.scale_basis(r, 0.2, nu), kv.scale_brush(r, 0.7, 0.2, nu), atol=1e-15)
    assert np.allclose(kv.grab_smooth_basis(r, 0.2) @ d, kv.grab_smooth(r, d, 0.2), atol=1e-15)
    assert np.allclose(0.7 * kv.scale_smooth_basis(r, 0.2), kv.scale_smooth(r, 0.7, 0.2), atol=1e-15)


def test_zero_outside_support(frame):
    f = BustField(frame)
    S = frame["S"]
    for b in ([0, -1.0, 0.2], [0.9, 0, 0.2], [0, 0.6, 0.2], [0.24, 0, -0.6]):
        p = from_body(frame, [v * S for v in b])
        for t in f.targets:
            assert np.all(f.delta(t, p) == 0), (t, b)


def test_mirror_symmetry_and_midline(frame):
    f = BustField(frame)
    S = frame["S"]
    rot = {**frame, "origin": [0, 0, 0]}
    for b in ([0.2, 0.05, 0.4], [0.35, -0.1, 0.3], [0.05, 0.1, 0.35]):
        pL = from_body(frame, [v * S for v in b])
        pR = from_body(frame, [-b[0] * S, b[1] * S, b[2] * S])
        for t in f.targets:
            dL = to_body(rot, f.delta(t, pL))
            dR = to_body(rot, f.delta(t, pR))
            assert np.allclose(dL, [-dR[0], dR[1], dR[2]], atol=1e-12)
    for y in (-0.2, 0, 0.1):
        p = from_body(frame, [0, y * S, 0.35 * S])
        for t in f.targets:
            assert abs(to_body(rot, f.delta(t, p))[0]) < 1e-12


def test_default_params_injective(frame):
    r = field_check(BustField(frame), 10)
    assert r["injective"] and r["minDet"] > 0.1
    assert len(extreme_combos()) == 27


def test_assemble_is_the_fields_linear_map(frame):
    """design @ c == delta of the ops built from c, for both kernels; the FD
    Jacobian columns equal the field's FD Jacobian (distillation and the det
    constraints rely on both)."""
    for kernel in ("kelvinlet", "smooth"):
        base = clone_params(DEFAULT_PARAMS)
        base["kernel"] = kernel
        f = BustField(frame, base)
        dic = Dictionary.lattice()
        c = np.random.default_rng(1).normal(0, 0.02, dic.K)
        fs = BustField(frame, params_with_targets(base, {"x": dic.to_ops(c, digits=17)}))
        P = np.concatenate([np.asarray(s.apex) + np.random.default_rng(2).normal(0, 0.15, (80, 3)) for s in f.sides])
        assert np.abs(design(f, dic, P) @ c - fs.delta("x", P)).max() < 1e-14
        Jc = jacobian_columns(f, dic, P[:40])
        assert np.abs((Jc @ c).reshape(-1, 3, 3) - fs.jacobian("x", P[:40])).max() < 1e-10


def test_dictionary_ops_round_trip():
    dic = Dictionary.lattice()
    c = np.random.default_rng(4).normal(0, 0.02, dic.K)
    assert np.allclose(dic.from_ops(dic.to_ops(c, digits=17)), c)
    assert len(dic) <= 64


def test_vectorized_matches_pointwise(frame):
    f = BustField(frame, random_params(5))
    P = np.asarray(f.sides[0].apex) + np.random.default_rng(0).normal(0, 0.2, (20, 3))
    for t in f.targets:
        D = f.delta(t, P)
        for i in range(0, 20, 5):
            assert np.array_equal(D[i], f.delta(t, P[i]))
