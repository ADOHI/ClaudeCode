import numpy as np
import pytest

from tools.teacher import snh
from tools.teacher.cases import growth_tensor
from tools.teacher.fem import Model, newton
from tools.teacher.heightmap import Grid
from tools.teacher.inverse import inverse_rest
from tools.teacher.modal import modes, physical
from tools.teacher.volume import TISSUE, ProxyVolume


def mound(nz=3, h=0.05, half=0.2):
    g = Grid.covering(-half, half, -half, half, h)
    X, Y = g.node_xy()
    top = 0.1 + 0.15 * np.clip(1 - (X ** 2 + Y ** 2) / 0.03, 0, None)
    bot = np.zeros_like(top)
    vol = ProxyVolume(g, top, bot, np.ones((g.nx - 1, g.ny - 1), bool), nz)
    C = vol.tet_centroids()
    r = np.hypot(C[:, 0], C[:, 1])
    vol.material[:] = np.where(r < 0.17, TISSUE, 0)
    vol.side[:] = np.where(vol.material == TISSUE, np.where(C[:, 0] >= 0, 1, -1), 0)
    vol.growth_w[:] = np.where(vol.material == TISSUE, np.clip(1.5 - r / 0.17 * 1.5, 0, 1), 0)
    vol.footprint = {'cx': 0.0, 'cy': 0.0}
    return vol


def make_model(vol, nu=0.45, lig=True):
    T = len(vol.tets)
    mu, lam = snh.lame(np.where(vol.material == TISSUE, 1.0, 2.0), np.full(T, nu))
    ligs = None
    if lig:
        nodes = np.nonzero(~vol.fixed & (vol.node_layer > 0))[0]
        A = vol.X[nodes] + np.array([0.0, 0.5, -0.05])
        ligs = {'nodes': nodes, 'anchors': A, 'weight': np.full(len(nodes), 1e-3), 'kappa': 4.0}
    return Model(vol, mu, lam, np.ones(T), ligs)


def full_loads(vol, alpha=1.0):
    Fg = growth_tensor((1.3) ** (alpha * vol.growth_w), 0.5, [0, 0, 1])
    return dict(Fg=Fg, gamma=3.0 * alpha, gdir=[0.0, -0.99, -0.1], prestress=0.1 * alpha, tension=0.05 * alpha, lateral=1.0 * alpha)


def test_gradient_and_hessian_match_finite_differences():
    vol = mound()
    m = make_model(vol)
    m.set_rest(vol.X)
    m.set_loads(**full_loads(vol))
    rng = np.random.default_rng(0)
    x = vol.X + 0.003 * rng.standard_normal(vol.X.shape) * (~vol.fixed)[:, None]
    assert np.isfinite(m.energy(x))
    # Prestress 0.1 shortens the ligament rest length: all of them pull.
    assert (np.linalg.norm(x[m.lig['nodes']] - m.lig['anchors'], axis=1) > m.lig_l0).all()
    g = m.gradient(x).ravel()
    free = np.nonzero(m.free_dof)[0]
    h = 1e-6
    for k in rng.choice(free, 12, replace=False):
        xp, xm = x.copy(), x.copy()
        xp.reshape(-1)[k] += h
        xm.reshape(-1)[k] -= h
        num = (m.energy(xp) - m.energy(xm)) / (2 * h)
        assert abs(num - g[k]) < 1e-6 * max(1.0, abs(g[k]))
    H = m.hessian(x, project=False).toarray()
    dmap = m.dof_map
    for k in rng.choice(free, 6, replace=False):
        xp, xm = x.copy(), x.copy()
        xp.reshape(-1)[k] += h
        xm.reshape(-1)[k] -= h
        col = (m.gradient(xp).ravel() - m.gradient(xm).ravel())[free] / (2 * h)
        assert np.abs(H[:, dmap[k]] - col).max() < 1e-5 * max(1.0, np.abs(col).max())
    assert np.allclose(H, H.T, atol=1e-10)
    Hp = m.hessian(x, project=True)
    assert np.linalg.eigvalsh(Hp.toarray()).min() > -1e-9


def test_newton_reaches_tight_residual_and_keeps_tets_valid():
    vol = mound()
    m = make_model(vol)
    m.set_rest(vol.X)
    x = vol.X.copy()
    for a in (0.5, 1.0):
        m.set_loads(**full_loads(vol, a))
        x, info = newton(m, x, tol=1e-10)
        assert info['converged'] and info['residual'] < 1e-9
        assert info['min_det'] > 0
    assert np.abs(x[vol.fixed] - vol.X[vol.fixed]).max() == 0


def test_isotropic_growth_gives_prescribed_volume():
    # Bottom-fixed block, nearly incompressible: volume ratio -> 1 + s
    # (the newton 1.7 VBD check by the critic gave 1.2935 for s = 0.3).
    g = Grid.covering(-0.1, 0.1, -0.1, 0.1, 0.04)
    top = np.full((g.nx, g.ny), 0.2)
    vol = ProxyVolume(g, top, np.zeros_like(top), np.ones((g.nx - 1, g.ny - 1), bool), 5)
    vol.fixed = vol.node_layer == 0
    vol.material[:] = TISSUE
    m = make_model(vol, nu=0.49, lig=False)
    m.set_rest(vol.X)
    V0 = m.tissue_volume(vol.X)
    x = vol.X.copy()
    for a in (0.5, 1.0):
        m.set_loads(Fg=growth_tensor(np.full(len(vol.tets), 1.3 ** a), 0.0, [0, 0, 1]))
        x, info = newton(m, x)
    ratio = m.tissue_volume(x) / V0
    assert abs(ratio / 1.3 - 1) < 0.01
    # Anterior anisotropy: same volume, more growth along z than across.
    m.set_loads(Fg=growth_tensor(np.full(len(vol.tets), 1.3), 1.0, [0, 0, 1]))
    xa, _ = newton(m, x)
    assert abs(m.tissue_volume(xa) / V0 / 1.3 - 1) < 0.01
    assert xa[:, 2].max() > x[:, 2].max() + 0.02


def test_inverse_rest_reproduces_target():
    vol = mound()
    m = make_model(vol)
    loads = dict(gamma=4.0, gdir=[0.0, -1.0, 0.0])
    Xr, x, info = inverse_rest(m, vol.X, loads, tol=1e-9, maxit=40)
    assert info['error_max_S'] <= 1e-9
    # Forward check from scratch: equilibrium of X_rest under the loads is X.
    m.set_rest(Xr)
    m.set_loads(**loads)
    xf, _ = newton(m, Xr.copy(), f_ref=np.linalg.norm(m.f_ext))
    assert np.abs(xf - vol.X).max() < 1e-7
    # The rest shape sits above the authored one (gravity pulls it down).
    top = vol.node_layer == vol.nz
    assert (Xr - vol.X)[top & ~vol.fixed, 1].mean() > 0


def test_inverse_budget_exhaustion_returns_the_solved_rest_state():
    vol = mound(nz=2, h=0.1)
    m = make_model(vol)
    loads = dict(gamma=4.0, gdir=[0.0, -1.0, 0.0])
    Xr, x, info = inverse_rest(m, vol.X, loads, tol=1e-14, maxit=1)
    assert not info['converged'] and info['error_max_S'] > 1e-14
    assert np.array_equal(Xr, m.X_rest)
    assert np.array_equal(Xr, vol.X)
    # The returned equilibrium belongs to the returned rest shape, even if
    # inversion did not reach its target before the iteration budget ran out.
    m.set_rest(Xr)
    m.set_loads(**loads)
    assert np.linalg.norm(m.gradient(x).ravel()[m.free_dof]) < 1e-7


def test_inverse_requires_an_iteration():
    with pytest.raises(ValueError, match='maxit'):
        inverse_rest(None, None, {}, maxit=0)


def test_modes_are_valid_generalized_eigenpairs():
    vol = mound()
    m = make_model(vol, lig=False)
    m.set_rest(vol.X)
    m.set_loads(gamma=2.0, gdir=[0, -1, 0])
    x, _ = newton(m, vol.X.copy(), f_ref=np.linalg.norm(m.f_ext))
    md = modes(m, x, count=4)
    assert md['stable'] and np.all(np.diff(md['omega2']) >= 0)
    K = m.hessian(x, project=False)
    Md = np.repeat(m.lumped_mass(), 3)[m.free_dof]
    for k in range(4):
        p = md['phi'][k].ravel()[m.free_dof]
        assert abs(p @ (Md * p) - 1) < 1e-8
        r = K @ p - md['omega2'][k] * Md * p
        assert np.linalg.norm(r) < 1e-6 * np.linalg.norm(K @ p)
    # Participation: sum of effective masses over all modes = moving mass;
    # with 4 of them it is bounded by it.
    assert (md['mass_fraction'].sum(0) <= 1 + 1e-9).all()
    # Physical time unit: T0 = sqrt(g0 S / g).
    w, T0 = physical(md, 2.0, 0.36)
    assert abs(T0 - np.sqrt(2.0 * 0.36 / 9.81)) < 1e-12 and np.allclose(w * T0, md['omega_hat'])


@pytest.mark.parametrize('beta', [0.0, 0.5, 1.0])
def test_growth_tensor(beta):
    r = np.array([1.0, 1.35, 0.8])
    F = growth_tensor(r, beta, [0, 0, 1])
    assert np.allclose(np.linalg.det(F), r)
    assert np.allclose(F[:, 2, 2], r ** ((1 + 2 * beta) / 3))
