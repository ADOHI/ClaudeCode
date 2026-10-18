"""docs/params.schema.json describes what field.js consumes."""

import copy

import pytest
from helpers import needs_changli, needs_node, random_params

from bustfield.field import DEFAULT_PARAMS
from bustfield.jsbridge import eval_js
from bustfield.schema import errors, load_schema, validate


@needs_node
def test_js_default_params_valid():
    validate(eval_js({})["defaultParams"])


def test_python_params_valid():
    validate(DEFAULT_PARAMS)
    validate(random_params(3))
    p = copy.deepcopy(DEFAULT_PARAMS)
    p["$schema"] = "../docs/params.schema.json"
    p["_meta"] = {"source": "distill"}
    p["kernel"] = "smooth"
    p["targets"]["custom_shape"] = [{"type": "scale", "at": [0, 0, 0], "radius": 0.1}]  # k defaults to 0 in field.js
    validate(p)


def test_runtime_linear_and_antisymmetric_ops_valid():
    p = copy.deepcopy(DEFAULT_PARAMS)
    p['targets']['runtime'] = [
        {'type': 'linear', 'at': [0, 0, 0], 'A': [0.1, 0, 0, 0, -0.1, 0, 0, 0, 0], 'parity': -1},
        {'type': 'linear', 'at': [0, 0, 0], 'A': [0] * 9, 'radius': 0.2},
    ]
    p['targets']['bust_lift_up'][0]['parity'] = -1
    validate(p)
    for change in ({'A': [0] * 8}, {'radius': -0.1}, {'parity': 0}, {'parity': True}, {'A': [float('inf')] * 9}):
        bad = copy.deepcopy(p)
        bad['targets']['runtime'][0].update(change)
        assert errors(bad), change


@needs_changli
def test_bind_export_params_valid(changli):
    validate(changli.params)


@pytest.mark.parametrize(
    "mutate, needle",
    [
        (lambda p: p.pop("window"), "missing required 'window'"),
        (lambda p: p.update(depth=0), "exclusiveMinimum"),
        (lambda p: p.update(kernel="gauss"), "not in"),
        (lambda p: p.update(midlineLok=0.1), "unexpected key 'midlineLok'"),
        (lambda p: p["window"].update(hardness=1), "exclusiveMaximum"),
        (lambda p: p["targets"]["bust_lift_up"][0].pop("d"), "oneOf"),
        (lambda p: p["targets"]["bust_lift_up"][0].update(radious=0.2), "oneOf"),
        (lambda p: p["targets"]["bust_lift_up"][0].update(nu=0.7), "oneOf"),
        (lambda p: p["targets"]["bust_lift_up"][0].update(at=[0, 0]), "oneOf"),
        (lambda p: p["targets"]["bust_lift_up"][0].update(type="pinch"), "oneOf"),
        (lambda p: p["targets"].update({"bad name": []}), "does not match"),
        (lambda p: p["anchor"].update(x="0.2"), "expected number"),
        (lambda p: p["targets"]["bust_lift_up"][0].update(d=[0, float("nan"), 0]), "oneOf"),
    ],
)
def test_invalid_params_rejected(mutate, needle):
    p = copy.deepcopy(DEFAULT_PARAMS)
    mutate(p)
    errs = errors(p)
    assert errs and any(needle in e for e in errs), errs


def test_schema_uses_only_supported_keywords():
    # errors() raises on unknown keywords; walking the whole schema with a
    # valid document visits every node that matters.
    s = load_schema()
    assert s["$schema"].endswith("2020-12/schema")
    assert errors(DEFAULT_PARAMS) == []


def test_jsonschema_cross_check():
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(DEFAULT_PARAMS, load_schema())
