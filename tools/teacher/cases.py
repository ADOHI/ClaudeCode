"""Physics dials -> load cases.

The optimizer (CMA-ES, decision-v2 3(c)) searches over at most 8 scalar
dials. Each target is a fixed recipe of coefficients on those dials, applied
on top of the authored (default) state:

    growth       s    volume growth of the tissue: ratio (1 + s)^c
    anisotropy   beta share of growth along the body forward axis (0 = isotropic, 1 = all anterior)
    gravity      g0   effective gravity number rho g S / mu of the authored state
    lift         l    fractional change of gravity: g = g0 (1 + c l)
    ligament     p    Cooper-ligament prestress: rest length (1 - c p) of the rest distance
    skinTension  tau  tension of the front surface (units mu S): rounds the mound
    lateral      f    lateral body force (units mu / S), outward for c > 0
    nu           nu   Poisson ratio of tissue and subcutaneous margin

The default (weight 0) state is: no growth, gravity g0, slack ligaments
(p = 0, they engage only when stretched), no skin tension, no lateral force.
"""

import copy

import numpy as np

DIAL_NAMES = ('growth', 'anisotropy', 'gravity', 'lift', 'ligament', 'skinTension', 'lateral', 'nu')

DEFAULT_CONFIG = {
    'dials': {
        'growth': 0.35,
        'anisotropy': 0.6,
        'gravity': 5.0,
        'lift': 0.7,
        'ligament': 0.06,
        'skinTension': 0.03,
        'lateral': 6.0,
        'nu': 0.45,
    },
    # Coefficients on the dials per target (missing = 0). size_down uses
    # growth -1: volume ratio 1 / (1 + s), the inverse of size_up.
    'cases': {
        'bust_size_up_natural': {'growth': 1},
        'bust_size_up_stylized': {'growth': 1, 'anisotropy': 1, 'lift': -0.5, 'ligament': 1, 'skinTension': 1},
        'bust_size_down': {'growth': -1},
        'bust_lift_up': {'lift': -1, 'ligament': 1},
        'bust_lift_down': {'lift': 1, 'ligament': -1},
        'bust_spread_out': {'lateral': 1},
        'bust_spread_in': {'lateral': -1},
    },
    'volume': {
        'cell': 0.025,  # S, height-map / hex size
        'layers': 6,
        'skinMaterials': None,  # None = every masked triangle
        'envelopeMaterials': None,  # tight clothing that stands in for deleted skin
        'footprintScale': 0.65,  # tissue footprint = field window radii * scale around the apex
        'growthCore': 0.5,  # growth weight 1 inside this footprint radius, C2 falloff to 0 at 1
        'wallOffset': 0.03,  # S, chest wall below the flattened surface
        'minThickness': 0.02,  # S
        'maxSlope': 4.0,  # silhouette trim
    },
    'material': {
        'marginMu': 2.0,  # subcutaneous layer around the breasts (tissue mu = 1)
        'fillerMu': 0.3,  # air/cloth bridging the cleavage: soft, compressible, light
        'fillerNu': 0.4,
        'fillerRho': 0.3,
        'gravityDir': 'world',  # 'world' = bind-space -Y, 'body' = -frame.up
    },
    'ligament': {
        'kappa': 4.0,  # stiffness relative to tissue shear modulus
        'anchorY': 0.44,  # anchors (clavicle line) this far above the anchor centre, S
    },
    'solver': {
        'tol': 1e-10,
        'maxit': 60,
        'steps': 3,  # load continuation steps per case
        'inverseTol': 1e-7,  # S, max |x_eq(X_rest) - X_authored|
        'inverseMaxit': 40,
    },
    'modes': {
        'count': 6,
        'metersPerS': 0.36,  # physical shoulder width for Hz / SI outputs
        'damping': 0.15,  # suggested modal damping ratio for the runtime (not baked)
        'shapeAmplitude': 0.05,  # S, max skin displacement of the normalized mode shapes
    },
    'samples': {
        'shellOffsets': [0.03, 0.06],  # S, along the vertex normal
        'sampleMaterials': None,  # None = skin + envelope materials
        'maxAboveSurface': 0.05,  # S, mesh vertices further out than this are not skin samples
    },
}

# Model-specific settings (material groups) known for the test models.
PRESETS = {
    'changli': {'volume': {'skinMaterials': ['UP_Skin'], 'envelopeMaterials': ['UP']}},
}


def merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def check_dials(d):
    extra = set(d) - set(DIAL_NAMES)
    if extra:
        raise ValueError(f'unknown dials {sorted(extra)} (allowed: {DIAL_NAMES})')
    if not 0 < d['nu'] < 0.5:
        raise ValueError('nu must be in (0, 0.5)')
    if d['growth'] <= -1:
        raise ValueError('growth must be > -1')


def growth_tensor(ratio, beta, forward):
    """Fg with det = ratio (per tet, array) and anterior share beta:
    stretch ratio^((1+2b)/3) along `forward`, ratio^((1-b)/3) across."""
    ratio = np.asarray(ratio, float)
    f = np.asarray(forward, float) / np.linalg.norm(forward)
    la = ratio ** ((1 + 2 * beta) / 3)
    lt = ratio ** ((1 - beta) / 3)
    ff = np.outer(f, f)
    return lt[:, None, None] * (np.eye(3) - ff)[None] + la[:, None, None] * ff[None]


def case_loads(name, cfg, vol, gdir, forward=(0.0, 0.0, 1.0), alpha=1.0):
    """Load parameters for Model.set_loads for target `name` at continuation
    fraction alpha (0 = default state, 1 = full target)."""
    d = cfg['dials']
    c = cfg['cases'][name]
    g0 = d['gravity']
    out = {'gamma': g0 * (1 + alpha * c.get('lift', 0) * d['lift']), 'gdir': gdir,
           'prestress': alpha * c.get('ligament', 0) * d['ligament'],
           'tension': alpha * c.get('skinTension', 0) * d['skinTension'],
           'lateral': alpha * c.get('lateral', 0) * d['lateral'], 'Fg': None}
    cg = c.get('growth', 0)
    if cg:
        ratio = (1 + d['growth']) ** (alpha * cg * vol.growth_w)
        out['Fg'] = growth_tensor(ratio, c.get('anisotropy', 0) * d['anisotropy'], forward)
    return out


def default_loads(cfg, gdir):
    return {'gamma': cfg['dials']['gravity'], 'gdir': gdir, 'prestress': 0.0, 'tension': 0.0, 'lateral': 0.0, 'Fg': None}


def prescribed_tissue_volume(cfg, name, vol, V_rest):
    """Tissue volume the growth prescribes, relative to the ungrown rest
    volume (ratio of sums over tissue tets)."""
    from .volume import TISSUE
    t = vol.material == TISSUE
    c = cfg['cases'][name].get('growth', 0)
    ratio = (1 + cfg['dials']['growth']) ** (c * vol.growth_w[t])
    return float((V_rest[t] * ratio).sum() / V_rest[t].sum())
