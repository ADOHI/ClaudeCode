import numpy as np

from tools.teacher.bind import BindExport
from tools.teacher.heightmap import Grid, harmonic_fill, rasterize_max
from tools.teacher.volume import FILLER, TISSUE, ProxyVolume, build_from_bind, signed_volume
from tools.teacher.cases import DEFAULT_CONFIG
from tools.teacher.synthetic import synthetic_bind, torso_height


def cap_volume(nz=3, h=0.05):
    g = Grid.covering(-0.3, 0.3, -0.25, 0.25, h)
    X, Y = g.node_xy()
    top = 0.2 + 0.15 * np.clip(1 - (X ** 2 + Y ** 2) / 0.04, 0, None)
    bot = 0.05 * X  # tilted chest wall
    cells = np.ones((g.nx - 1, g.ny - 1), bool)
    cells[0, 0] = False  # a notch: rim must follow it
    return ProxyVolume(g, top, bot, cells, nz), top, bot


def test_extrusion_is_valid_and_conforming():
    vol, top, bot = cap_volume()
    V = signed_volume(vol.X, vol.tets)
    assert V.min() > 0
    # Total volume = integral of the piecewise-linear thickness (Kuhn split).
    g = vol.grid
    T = top - bot
    tot = 0.0
    for i, j in vol.cell_ij:
        t00, t10, t01, t11 = T[i, j], T[i + 1, j], T[i, j + 1], T[i + 1, j + 1]
        tot += g.h * g.h / 2 * ((t00 + t10 + t11) / 3 + (t00 + t11 + t01) / 3)
    assert abs(V.sum() - tot) < 1e-12
    # Every interior face is shared by exactly two tets, boundary faces by one.
    faces = np.sort(np.concatenate([vol.tets[:, [0, 1, 2]], vol.tets[:, [0, 1, 3]], vol.tets[:, [0, 2, 3]], vol.tets[:, [1, 2, 3]]]), axis=1)
    uf, cnt = np.unique(faces, axis=0, return_counts=True)
    assert cnt.max() == 2
    # Conforming: faces used once lie on the hull (front, wall or rim sides),
    # including across x = 0 where the Kuhn split is mirrored.
    rim_col = np.zeros(len(vol.col_ij), bool)
    rim_col[vol.node_col[vol.fixed & (vol.node_layer > 0)]] = True
    lay = vol.node_layer[uf[cnt == 1]]
    on_hull = (lay == 0).all(1) | (lay == vol.nz).all(1) | rim_col[vol.node_col[uf[cnt == 1]]].all(1)
    assert on_hull.all()
    assert vol.cell_mirror.any() and not vol.cell_mirror.all()
    # Front surface triangles face forward.
    a, b, c = (vol.X[vol.top_tris[:, k]] for k in range(3))
    assert np.cross(b - a, c - a)[:, 2].min() > 0


def test_fixed_nodes_are_wall_and_rim():
    vol, _, _ = cap_volume()
    assert vol.fixed[vol.node_layer == 0].all()
    top = vol.node_layer == vol.nz
    # Rim columns of the notched rectangle are fixed through all layers.
    ci, cj = vol.col_ij[vol.node_col, 0], vol.col_ij[vol.node_col, 1]
    g = vol.grid
    rim = (ci == 0) | (cj == 0) | (ci == g.nx - 1) | (cj == g.ny - 1) | ((ci <= 1) & (cj <= 1))
    assert vol.fixed[rim].all()
    assert not vol.fixed[top & ~rim].any()


def test_locate_inside_and_clamped():
    vol, top, bot = cap_volume()
    rng = np.random.default_rng(0)
    C = vol.tet_centroids()
    P = C[rng.choice(len(C), 300)] + rng.normal(0, 0.005, (300, 3))
    zb, zt = vol.surface_heights(P).T
    P[:, 2] = np.clip(P[:, 2], zb, zt)
    tet, bary, clamped = vol.locate(P)
    ok = tet >= 0
    assert ok.mean() > 0.95
    assert bary[ok].min() > -1e-9
    rec = np.einsum('mk,mkd->md', bary[ok], vol.X[vol.tets[tet[ok]]])
    assert np.abs(rec - P[ok]).max() < 1e-12
    assert np.abs(clamped[ok]).max() < 1e-12
    # Above the skin: clamped onto the front surface (constant extrapolation).
    Q = P[ok].copy()
    Q[:, 2] = zt[ok] + 0.07
    tet2, bary2, cl2 = vol.locate(Q)
    assert np.allclose(cl2, 0.07)
    rec2 = np.einsum('mk,mkd->md', bary2, vol.X[vol.tets[tet2]])
    assert np.allclose(rec2[:, 2], zt[ok])
    # Affine fields are interpolated exactly.
    A = np.array([[0.1, 0.2, -0.3], [0.0, 0.1, 0.2], [0.3, -0.1, 0.05]])
    U = vol.interpolate(tet, bary, vol.X @ A.T)
    assert np.abs(U[ok] - P[ok] @ A.T).max() < 1e-12


def test_rasterize_and_fill():
    g = Grid.covering(-0.2, 0.2, -0.2, 0.2, 0.05)
    # Two triangles covering the square at z = x + 2y.
    B = np.array([[-1, -1, -3], [1, -1, -1], [1, 1, 3], [-1, 1, 1]], float)
    H = rasterize_max(g, B, np.array([[0, 1, 2], [0, 2, 3]]))
    X, Y = g.node_xy()
    assert np.allclose(H, X + 2 * Y)
    known = np.ones_like(H, bool)
    known[2:-2, 2:-2] = False
    F = harmonic_fill(H, known, np.ones_like(H, bool))
    # Linear functions are harmonic: the fill reproduces them.
    assert np.abs(F - (X + 2 * Y)).max() < 1e-6


def test_build_from_synthetic_bind():
    bind = BindExport(synthetic_bind())
    cfg = dict(DEFAULT_CONFIG['volume'], cell=0.04, layers=3)
    vol, info = build_from_bind(bind, cfg)
    assert signed_volume(vol.X, vol.tets).min() > 0
    t = vol.material == TISSUE
    C = vol.tet_centroids()
    nl, nr = (t & (C[:, 0] > 0)).sum(), (t & (C[:, 0] < 0)).sum()
    assert nl > 100 and nl == nr  # symmetric mesh -> symmetric volume
    # The tet mesh itself is mirror-symmetric (mirrored Kuhn split).
    key = lambda P: set(map(tuple, np.round(P * 1e6).astype(np.int64)))
    assert key(C[C[:, 0] > 0]) == key(C[C[:, 0] < 0] * [-1, 1, 1])
    # The front surface is the mesh: compare with the analytic height.
    top = vol.node_layer == vol.nz
    z = torso_height(vol.X[top, 0], vol.X[top, 1])
    assert np.abs(vol.X[top, 2] - z).max() < 2e-3
    # Tissue sits on top of a flattened wall: thickest near the apex.
    a = np.argmax(np.where(top & (vol.X[:, 0] > 0), vol.X[:, 2], -np.inf))
    assert abs(vol.X[a, 0] - 0.27) < 0.05 and abs(vol.X[a, 1] - 0.3) < 0.05
    assert vol.growth_w[t].max() == 1.0 and vol.growth_w[~t].max() == 0.0
    assert not (vol.material == FILLER).any()  # no clothing bridge on a bare torso
