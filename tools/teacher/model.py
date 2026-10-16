"""Builds the FEM model (materials, ligaments, gravity direction) of a proxy volume."""

import numpy as np

from . import snh
from .fem import Model
from .volume import FILLER, MARGIN, TISSUE


def materials(vol, cfg):
    """Per-tet (mu, lam, rho) in units of the tissue shear modulus / density."""
    m = cfg['material']
    nu = cfg['dials']['nu']
    mu = np.ones(len(vol.tets))
    nus = np.full(len(vol.tets), nu)
    rho = np.ones(len(vol.tets))
    mu[vol.material == MARGIN] = m['marginMu']
    f = vol.material == FILLER
    mu[f] = m['fillerMu']
    nus[f] = m['fillerNu']
    rho[f] = m['fillerRho']
    mu, lam = snh.lame(mu, nus)
    return mu, lam, rho


def ligaments(vol, cfg):
    """Tension-only Cooper ligaments: every tissue node hangs from a point on
    the clavicle line straight above it, at chest-wall depth. Strength per
    node ~ its growth-weighted tissue volume, so the gland core is suspended
    and the periphery fades out."""
    t = vol.material == TISSUE
    V = np.abs(np.linalg.det(np.stack([vol.X[vol.tets[t, k]] - vol.X[vol.tets[t, 0]] for k in (1, 2, 3)], 2))) / 6
    w = np.zeros(vol.n_nodes)
    for k in range(4):
        np.add.at(w, vol.tets[t, k], V * vol.growth_w[t] / 4)
    nodes = np.nonzero((w > 0) & ~vol.fixed)[0]
    col = vol.node_col[nodes]
    ci, cj = vol.col_ij[col, 0], vol.col_ij[col, 1]
    A = np.stack([vol.X[nodes, 0],
                  np.full(len(nodes), vol.footprint['cy'] + cfg['ligament']['anchorY']),
                  vol.z_bot[ci, cj]], 1)
    return {'nodes': nodes, 'anchors': A, 'weight': w[nodes], 'kappa': cfg['ligament']['kappa']}


def gravity_dir(frame, cfg):
    if cfg['material'].get('gravityDir', 'world') == 'body':
        return np.array([0.0, -1.0, 0.0])
    g = frame.dir_to_body(np.array([0.0, -1.0, 0.0]))
    return g / np.linalg.norm(g)


def build_model(vol, cfg):
    mu, lam, rho = materials(vol, cfg)
    return Model(vol, mu, lam, rho, ligaments(vol, cfg))
