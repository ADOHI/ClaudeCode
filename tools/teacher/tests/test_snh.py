import numpy as np

from tools.teacher import snh
from tools.teacher.fem import tri_area_hessian, tri_area_terms


def rand_F(rng, n):
    return np.eye(3)[None] + 0.3 * rng.standard_normal((n, 3, 3))


def test_rest_stable_and_linearization():
    mu, lam = snh.lame(np.array([1.0]), np.array([0.3]))
    F = np.eye(3)[None]
    assert np.allclose(snh.pk1(F, mu, lam), 0, atol=1e-14)
    # Linearization at F = I is linear elasticity with the requested Lame pair.
    D = snh.dpdf(F, mu, lam)[0]
    lam_lin = 2 * 0.3 / (1 - 0.6)
    eps = np.array([[0.01, 0.002, 0], [0.002, -0.004, 0.003], [0, 0.003, 0.005]])
    sig = (D @ eps.T.reshape(9)).reshape(3, 3).T
    expect = 2 * eps + lam_lin * np.trace(eps) * np.eye(3)
    assert np.allclose(sig, expect, atol=1e-12)


def test_pk1_matches_energy_gradient():
    rng = np.random.default_rng(1)
    F = rand_F(rng, 5)
    mu = np.full(5, 1.3)
    lam = np.full(5, 7.0)
    P = snh.pk1(F, mu, lam)
    h = 1e-6
    for i in range(3):
        for j in range(3):
            Fp, Fm = F.copy(), F.copy()
            Fp[:, i, j] += h
            Fm[:, i, j] -= h
            num = (snh.psi(Fp, mu, lam) - snh.psi(Fm, mu, lam)) / (2 * h)
            assert np.allclose(P[:, i, j], num, rtol=1e-6, atol=1e-7)


def test_dpdf_matches_pk1_derivative_and_projection_is_psd():
    rng = np.random.default_rng(2)
    F = rand_F(rng, 4)
    mu = np.full(4, 1.0)
    lam = np.full(4, 10.0)
    H = snh.dpdf(F, mu, lam)
    h = 1e-6
    for k in range(9):
        c, r = divmod(k, 3)
        Fp, Fm = F.copy(), F.copy()
        Fp[:, r, c] += h
        Fm[:, r, c] -= h
        dP = (snh.pk1(Fp, mu, lam) - snh.pk1(Fm, mu, lam)) / (2 * h)
        col = np.swapaxes(dP, 1, 2).reshape(4, 9)
        assert np.allclose(H[:, :, k], col, rtol=1e-5, atol=1e-6)
    Hp = snh.dpdf(F, mu, lam, project=True)
    assert np.linalg.eigvalsh(Hp).min() > -1e-10


def test_triangle_area_gradient_and_hessian():
    rng = np.random.default_rng(3)
    x = rng.standard_normal((3, 3))
    tris = np.array([[0, 1, 2]])
    A, g, _, _ = tri_area_terms(x, tris)
    H = tri_area_hessian(x, tris)[0]
    h = 1e-6
    for k in range(9):
        xp, xm = x.copy(), x.copy()
        xp.reshape(-1)[k] += h
        xm.reshape(-1)[k] -= h
        num = (tri_area_terms(xp, tris)[0][0] - tri_area_terms(xm, tris)[0][0]) / (2 * h)
        assert abs(g[0].reshape(-1)[k] - num) < 1e-7
        gnum = (tri_area_terms(xp, tris)[1][0] - tri_area_terms(xm, tris)[1][0]).reshape(-1) / (2 * h)
        assert np.allclose(H[:, k], gnum, atol=1e-6)
    assert np.allclose(H, H.T, atol=1e-12)
