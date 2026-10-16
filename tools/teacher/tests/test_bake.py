import json
import os

import numpy as np
import pytest

from tools.teacher.bake import bake, load_config
from tools.teacher.bind import BindExport
from tools.teacher.cases import DIAL_NAMES, case_loads, default_loads, merge
from tools.teacher.modal import mirror_pairs
from tools.teacher.samples import KINDS
from tools.teacher.synthetic import synthetic_bind
from tools.teacher.volume import build_from_bind

COARSE = {
    'volume': {'cell': 0.05, 'layers': 3},
    'solver': {'steps': 2},
    'modes': {'count': 4},
}


def quiet(*a, **k):
    pass


@pytest.fixture(scope='module')
def baked(tmp_path_factory):
    out = tmp_path_factory.mktemp('teacher')
    cfg = merge(load_config(), COARSE)
    stats = bake(BindExport(synthetic_bind()), cfg, str(out), log=quiet)
    return out, cfg, stats


def test_acceptance_numbers(baked):
    out, cfg, stats = baked
    assert stats['inverse']['error_max_S'] <= 0.005
    assert set(stats['cases']) == set(cfg['cases'])
    for name, c in stats['cases'].items():
        assert c['converged'] and c['residual'] <= 1e-6, name
        assert c['tets_det_le_0'] == 0 and c['min_det_F_map'] > 0 and c['min_det_F_elastic'] > 0, name
        assert abs(c['volume_error_percent']) <= 5, name
        assert c['max_skin_displacement_S'] > 1e-3, name
    m = stats['modes']
    assert m['stable'] and len(m['freq_hz']) == 4 and np.all(np.diff(m['freq_hz']) >= 0) and m['freq_hz'][0] > 0


def test_physical_directions(baked):
    _, _, stats = baked
    out = baked[0]
    U = {n: np.load(os.path.join(out, n + '.npz')) for n in stats['cases']}
    d = U['bust_size_up_natural']
    skin = (d['kind'] == KINDS['skin']) & (d['side'] == 1)
    mean = lambda n: U[n]['U_body'][skin].mean(0)
    assert mean('bust_size_up_natural')[2] > 0 and mean('bust_size_down')[2] < 0
    assert mean('bust_lift_up')[1] > 0 and mean('bust_lift_down')[1] < 0
    assert mean('bust_spread_out')[0] > 0 and mean('bust_spread_in')[0] < 0
    # Natural growth sags more than the stylized one (gravity relief + ligaments).
    assert mean('bust_size_up_stylized')[1] > mean('bust_size_up_natural')[1]


def test_sample_file_format(baked):
    out, cfg, stats = baked
    meta = json.load(open(os.path.join(out, 'meta.json')))
    assert meta['format'] == 'bust-teacher/1' and set(meta['dials']) == set(DIAL_NAMES)
    S = meta['frame']['S']
    for name in meta['targets']:
        d = np.load(os.path.join(out, name + '.npz'))
        n = len(d['P'])
        assert d['U'].shape == (n, 3) and d['w'].shape == (n,) and d['kind'].shape == (n,)
        assert str(d['target']) == name and json.loads(str(d['dials'])) == cfg['dials']
        for k in KINDS.values():
            assert abs(d['w'][d['kind'] == k].sum() - 1) < 1e-9
        assert np.allclose(d['U'], d['U_body'] * S)  # identity frame in the synthetic export
        shell = d['kind'] == KINDS['shell']
        assert np.allclose(d['U_body'][shell], d['U_body'][d['parent'][shell]])
        skin = d['kind'] == KINDS['skin']
        assert (d['vid'][skin] >= 0).all() and (d['vid'][~skin] == -1).all()
    md = np.load(os.path.join(out, 'modes.npz'))
    skin = md['kind'] == KINDS['skin']
    amp = np.linalg.norm(md['shape_body'][:, skin], axis=2).max(1)
    assert np.allclose(amp, cfg['modes']['shapeAmplitude'])
    assert md['gamma_body'].shape == (4, 3) and np.allclose(md['freq_hz'], md['omega'] / (2 * np.pi))


def test_weight_zero_is_authored_and_targets_mirror(baked):
    out, cfg, stats = baked
    vol, _ = build_from_bind(BindExport(synthetic_bind()), cfg['volume'])
    pairs = mirror_pairs(vol)
    for name in ('bust_size_up_natural', 'bust_lift_up', 'bust_spread_out'):
        d = np.load(os.path.join(out, name + '.npz'))
        inter = d['kind'] == KINDS['interior']
        U = d['U_body'][inter]
        assert np.abs(U[vol.fixed]).max() == 0  # chest wall / rim stay put
        a, b = U[pairs[:, 0]], U[pairs[:, 1]] * [-1, 1, 1]
        assert np.abs(a - b).max() < 1e-6 * max(1.0, np.abs(U).max() * 1e3)
    # Continuation fraction 0 is exactly the default state.
    L0 = case_loads('bust_size_up_stylized', cfg, vol, [0, -1, 0], alpha=0.0)
    D = default_loads(cfg, [0, -1, 0])
    assert L0['gamma'] == D['gamma'] and L0['prestress'] == 0 and L0['tension'] == 0
    assert np.allclose(L0['Fg'], np.eye(3))


def test_units_scale_with_S(tmp_path):
    cfg = merge(load_config(), COARSE)
    a = bake(BindExport(synthetic_bind(scale=1.0)), cfg, str(tmp_path / 'a'), targets=['bust_lift_up'], with_modes=False, log=quiet)
    b = bake(BindExport(synthetic_bind(scale=2.5)), cfg, str(tmp_path / 'b'), targets=['bust_lift_up'], with_modes=False, log=quiet)
    da = np.load(tmp_path / 'a' / 'bust_lift_up.npz')
    db = np.load(tmp_path / 'b' / 'bust_lift_up.npz')
    assert np.allclose(db['U'], 2.5 * da['U'], atol=1e-6)
    assert np.allclose(db['U_body'], da['U_body'], atol=1e-6)
    assert abs(a['cases']['bust_lift_up']['max_displacement_S'] - b['cases']['bust_lift_up']['max_displacement_S']) < 1e-6
