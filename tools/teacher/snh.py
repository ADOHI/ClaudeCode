"""Stable Neo-Hookean (Smith, de Goes, Kim 2018), batched over tets.

    Psi(F) = mu/2 (I_C - 3) + lam/2 (J - alpha)^2,   alpha = 1 + mu / lam

Rest-stable (P(I) = 0) and defined for inverted F. Its linearization is linear
elasticity with Lame parameter lam - mu, so lam = lam_lin + mu
(`lame` below). vec(F) is column-major: index 3 c + r.
"""

import numpy as np


def lame(mu, nu):
    """SNH (mu, lam) from shear modulus and Poisson ratio of the linearization."""
    mu = np.asarray(mu, float)
    nu = np.asarray(nu, float)
    lam_lin = 2 * mu * nu / (1 - 2 * nu)
    return mu, lam_lin + mu


def cofactor(F):
    f0, f1, f2 = F[..., :, 0], F[..., :, 1], F[..., :, 2]
    return np.stack([np.cross(f1, f2), np.cross(f2, f0), np.cross(f0, f1)], axis=-1)


def psi(F, mu, lam):
    J = np.linalg.det(F)
    Ic = np.einsum('...ij,...ij->...', F, F)
    alpha = 1 + mu / lam
    return 0.5 * mu * (Ic - 3) + 0.5 * lam * (J - alpha) ** 2


def pk1(F, mu, lam):
    J = np.linalg.det(F)
    alpha = 1 + mu / lam
    return mu[..., None, None] * F + (lam * (J - alpha))[..., None, None] * cofactor(F)


def _hat(v):
    z = np.zeros(v.shape[:-1])
    return np.stack([
        np.stack([z, -v[..., 2], v[..., 1]], -1),
        np.stack([v[..., 2], z, -v[..., 0]], -1),
        np.stack([-v[..., 1], v[..., 0], z], -1),
    ], -2)


def dpdf(F, mu, lam, project=False):
    """d vec(P) / d vec(F), shape (..., 9, 9). With project=True the matrix is
    clamped to its positive semi-definite part (eigenvalue clamping), which
    keeps the assembled Hessian PSD for projected Newton."""
    J = np.linalg.det(F)
    alpha = 1 + mu / lam
    g = cofactor(F)
    gv = np.swapaxes(g, -1, -2).reshape(F.shape[:-2] + (9,))  # column-major vec
    f0, f1, f2 = F[..., :, 0], F[..., :, 1], F[..., :, 2]
    H = np.zeros(F.shape[:-2] + (9, 9))
    h0, h1, h2 = _hat(f0), _hat(f1), _hat(f2)
    # Hessian of J: blocks (c, c') = d^2 J / d f_c d f_c'
    H[..., 0:3, 3:6] = -h2
    H[..., 0:3, 6:9] = h1
    H[..., 3:6, 0:3] = h2
    H[..., 3:6, 6:9] = -h0
    H[..., 6:9, 0:3] = -h1
    H[..., 6:9, 3:6] = h0
    H *= (lam * (J - alpha))[..., None, None]
    H += lam[..., None, None] * gv[..., :, None] * gv[..., None, :]
    H += mu[..., None, None] * np.eye(9)
    if project:
        w, V = np.linalg.eigh(H)
        H = np.einsum('...ij,...j,...kj->...ik', V, np.maximum(w, 0.0), V)
    return H
