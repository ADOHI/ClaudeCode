"""Small-amplitude vibration modes around the authored equilibrium.

    K phi = w^2 M phi,   K = exact tangent stiffness at x_eq (includes the
    geometric stiffness of the gravity prestress), M = lumped mass,
    chest wall and rim fixed.

Both breasts are in one system, so modes come out as in-phase /
anti-phase pairs. Units are nondimensional (length S, stress = tissue mu,
density = tissue rho, time T0 = sqrt(rho S^2 / mu)); since the gravity
number is g0 = rho g S / mu, physical time follows from the physical
shoulder width alone: T0 = sqrt(g0 S_m / g).
"""

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

G_EARTH = 9.81


def modes(model, x_eq, count=6):
    K = model.hessian(x_eq, project=False)
    m = model.lumped_mass()
    Md = np.repeat(m, 3)[model.free_dof]
    M = sp.diags(Md)
    # Shift-invert around 0 gives the lowest modes; a K with negative
    # eigenvalues (unstable equilibrium) would show up as w^2 < 0.
    w2, phi = spla.eigsh(K.tocsc(), k=count, M=M.tocsc(), sigma=0.0, which='LM')
    order = np.argsort(w2)
    w2, phi = w2[order], phi[:, order]
    # eigsh returns M-orthonormal vectors; renormalize for safety.
    phi /= np.sqrt(np.einsum('ik,i,ik->k', phi, Md, phi))[None, :]
    full = np.zeros((count, model.N * 3))
    full[:, model.free_dof] = phi.T
    full = full.reshape(count, model.N, 3)
    # Participation for a uniform base acceleration along body axis d:
    # Gamma_kd = phi_k^T M r_d (r_d = unit translation of the free DOFs).
    mfree = m * (~model.fixed)
    gamma = np.einsum('kni,n->ki', full, mfree)
    total = mfree.sum()
    return {
        'omega2': w2, 'omega_hat': np.sqrt(np.maximum(w2, 0)), 'phi': full, 'gamma_hat': gamma,
        'mass_fraction': gamma ** 2 / total, 'total_mass': total, 'stable': bool(w2.min() > 0),
    }


def mirror_pairs(vol):
    """Node pairs (i, j) with node j the mirror image (x -> -x) of node i,
    found through the grid indices (the lattice is anchored at x = 0)."""
    g = vol.grid
    gi = np.round((g.x0 + g.h * vol.col_ij[vol.node_col, 0]) / g.h).astype(np.int64)
    gj = vol.col_ij[vol.node_col, 1]
    key = {(a, b, c): n for n, (a, b, c) in enumerate(zip(gi, gj, vol.node_layer))}
    pairs = [(n, key.get((-a, b, c))) for n, (a, b, c) in enumerate(zip(gi, gj, vol.node_layer)) if a > 0]
    pairs = np.array([p for p in pairs if p[1] is not None], dtype=np.int64).reshape(-1, 2)
    return pairs


def describe(md, vol):
    """Dominant direction and left/right symmetry (+1 in phase, -1 anti-phase)
    of each mode, for reports."""
    pairs = mirror_pairs(vol)
    mirror = np.array([-1.0, 1.0, 1.0])
    out = []
    for phi in md['phi']:
        e = np.abs(phi).sum(0)
        axis = ['lateral', 'vertical', 'fore-aft'][int(np.argmax(e))]
        sym = 0.0
        if len(pairs):
            a, b = phi[pairs[:, 0]], phi[pairs[:, 1]] * mirror
            sym = float(np.sum(a * b) / max(np.sqrt(np.sum(a * a) * np.sum(b * b)), 1e-300))
        out.append({'axis': axis, 'symmetry': sym, 'peak_node': int(np.argmax(np.linalg.norm(phi, axis=1)))})
    return out


def physical(md, gravity_number, meters_per_S):
    """omega (rad/s) and the time unit T0 (s) for a physical shoulder width."""
    T0 = np.sqrt(gravity_number * meters_per_S / G_EARTH)
    return md['omega_hat'] / T0, T0
