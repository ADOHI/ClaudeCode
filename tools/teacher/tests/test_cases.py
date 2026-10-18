import json

import numpy as np
import pytest

from tools.teacher.bake import load_config
from tools.teacher.cases import DEFAULT_CONFIG, DIAL_NAMES, case_loads, check_dials, merge


def test_at_most_eight_dials_and_every_case_uses_known_ones():
    assert len(DIAL_NAMES) <= 8
    assert set(DEFAULT_CONFIG['dials']) == set(DIAL_NAMES)
    allowed = set(DIAL_NAMES) - {'gravity', 'nu'}
    for name, coeffs in DEFAULT_CONFIG['cases'].items():
        assert name.startswith('bust_') and set(coeffs) <= allowed, name
    check_dials(DEFAULT_CONFIG['dials'])
    with pytest.raises(ValueError):
        check_dials(dict(DEFAULT_CONFIG['dials'], stiffness=1.0))
    with pytest.raises(ValueError):
        check_dials(dict(DEFAULT_CONFIG['dials'], nu=0.5))


def test_example_dials_file_matches_defaults():
    import os
    p = os.path.join(os.path.dirname(__file__), '..', 'dials.example.json')
    assert json.load(open(p))['dials'] == DEFAULT_CONFIG['dials']


def test_load_config_layers(tmp_path):
    p = tmp_path / 'c.json'
    p.write_text(json.dumps({'dials': {'growth': 0.5}, 'volume': {'layers': 4}}))
    cfg = load_config('changli', str(p), '{"lateral": 3.0}')
    assert cfg['dials']['growth'] == 0.5 and cfg['dials']['lateral'] == 3.0
    assert cfg['volume']['layers'] == 4 and cfg['volume']['skinMaterials'] == ['UP_Skin']
    assert DEFAULT_CONFIG['volume']['skinMaterials'] is None  # defaults untouched


@pytest.mark.parametrize('inverse_ok,modes_ok,code', [(True, True, 0), (False, True, 1), (True, False, 1)])
def test_bake_cli_rejects_failed_inverse_or_unstable_modes(monkeypatch, inverse_ok, modes_ok, code):
    import importlib
    module = importlib.import_module('tools.teacher.bake')
    monkeypatch.setattr(module.BindExport, 'load', lambda path: object())
    monkeypatch.setattr(module, 'bake', lambda *a, **kw: {
        'cases': {'bust_lift_up': {'tets_det_le_0': 0, 'converged': True}},
        'inverse': {'converged': inverse_ok}, 'modes': {'stable': modes_ok},
    })
    assert module.main(['--bind', 'synthetic.json', '--out', 'unused']) == code


class _Vol:
    growth_w = np.array([0.0, 0.5, 1.0])


def test_case_recipes():
    cfg = merge(DEFAULT_CONFIG, {})
    d = cfg['dials']
    up = case_loads('bust_size_up_natural', cfg, _Vol, [0, -1, 0])
    down = case_loads('bust_size_down', cfg, _Vol, [0, -1, 0])
    # size_down is the inverse growth of size_up, weighted per tet.
    assert np.allclose(np.linalg.det(up['Fg']) * np.linalg.det(down['Fg']), 1.0)
    assert np.isclose(np.linalg.det(up['Fg'])[2], 1 + d['growth'])
    lu = case_loads('bust_lift_up', cfg, _Vol, [0, -1, 0])
    ld = case_loads('bust_lift_down', cfg, _Vol, [0, -1, 0])
    assert lu['gamma'] < d['gravity'] < ld['gamma'] and lu['prestress'] > 0 > ld['prestress']
    so = case_loads('bust_spread_out', cfg, _Vol, [0, -1, 0])
    si = case_loads('bust_spread_in', cfg, _Vol, [0, -1, 0])
    assert so['lateral'] == -si['lateral'] > 0
    st = case_loads('bust_size_up_stylized', cfg, _Vol, [0, -1, 0])
    assert st['tension'] > 0 and st['gamma'] < d['gravity'] and st['Fg'][2, 2, 2] > st['Fg'][2, 0, 0]
