"""Proxy tissue volume: height-map extrusion -> structured hexes -> Kuhn tets.

Between the front surface z_top(x, y) (skin, or tight clothing where the
model has no skin under it) and a chest wall z_bot(x, y), every grid cell is
a column of `nz` hexes whose vertical edges stay vertical. Each hex is split
into the 6 Kuhn tets around its main diagonal; all hexes use the same split,
so the mesh is conforming, and a Kuhn tet's volume is +-h^2 dz / 6 with dz
the layer thickness of one column: positive thickness everywhere is enough
for a valid mesh, however steep the surface.

Everything is in body-frame / S units (bind.Frame.to_body).
"""

import itertools

import numpy as np
from scipy import ndimage

from .heightmap import Grid, harmonic_fill, rasterize_max

MARGIN, TISSUE, FILLER = 0, 1, 2
MATERIAL_NAMES = {MARGIN: 'margin', TISSUE: 'tissue', FILLER: 'filler'}

# Kuhn tets of the unit cube; corner id = dx + 2 dy + 4 dz.
_AX = (1, 2, 4)
KUHN = np.array([[0, _AX[a], _AX[a] + _AX[b], 7] for a, b, _ in itertools.permutations(range(3))])


def falloff(t, hard):
    """field.js falloff: 1 up to `hard`, C2 smootherstep to 0 at t = 1."""
    t = np.asarray(t, float)
    u = np.clip((t - hard) / (1 - hard), 0, 1)
    return 1 - u * u * u * (u * (u * 6 - 15) + 10)


def ellipse_radius(x, y, cx, cy, rx, ry_up, ry_down):
    ry = np.where(y >= cy, ry_up, ry_down)
    return np.hypot((x - cx) / rx, (y - cy) / ry)


class ProxyVolume:
    """Extruded tet mesh plus point location in the extrusion."""

    def __init__(self, grid, z_top, z_bot, cell_active, nz):
        self.grid, self.nz = grid, int(nz)
        nx, ny = grid.nx, grid.ny
        cell_active = np.asarray(cell_active, bool)
        col_active = np.zeros((nx, ny), bool)
        for di in (0, 1):
            for dj in (0, 1):
                col_active[di:nx - 1 + di, dj:ny - 1 + dj] |= cell_active
        if np.any((z_top - z_bot)[col_active] <= 0):
            raise ValueError('non-positive thickness in an active column')
        self.cell_active, self.col_active = cell_active, col_active
        self.z_top, self.z_bot = z_top, z_bot

        # Nodes: column-major over active columns, nz + 1 layers each.
        ci, cj = np.nonzero(col_active)
        self.col_ij = np.stack([ci, cj], 1)
        col_id = -np.ones((nx, ny), np.int64)
        col_id[ci, cj] = np.arange(len(ci))
        self.col_id = col_id
        L = self.nz + 1
        t = np.arange(L) / self.nz
        xs, ys = grid.xs[ci], grid.ys[cj]
        zb, zt = z_bot[ci, cj], z_top[ci, cj]
        X = np.empty((len(ci), L, 3))
        X[:, :, 0] = xs[:, None]
        X[:, :, 1] = ys[:, None]
        X[:, :, 2] = zb[:, None] + (zt - zb)[:, None] * t[None, :]
        self.X = X.reshape(-1, 3)
        self.node_col = np.repeat(np.arange(len(ci)), L)
        self.node_layer = np.tile(np.arange(L), len(ci))

        # Hexes -> tets.
        hi, hj = np.nonzero(cell_active)
        self.cell_ij = np.stack([hi, hj], 1)
        cell_id = -np.ones((nx - 1, ny - 1), np.int64)
        cell_id[hi, hj] = np.arange(len(hi))
        self.cell_id = cell_id
        # Cells left of the midline use the x-mirrored Kuhn split, so a
        # mirror-symmetric surface gives a mirror-symmetric tet mesh (left and
        # right targets then match). Still conforming: neighbours across x = 0
        # share an x-face, whose split does not change under the mirror.
        self.cell_mirror = grid.xs[hi] + 0.5 * grid.h < 0
        corners = np.empty((len(hi), self.nz, 8), np.int64)
        for c in range(8):
            dx, dy, dz = c & 1, (c >> 1) & 1, (c >> 2) & 1
            cid = col_id[hi + np.where(self.cell_mirror, 1 - dx, dx), hj + dy]
            corners[:, :, c] = cid[:, None] * L + np.arange(self.nz)[None, :] + dz
        tets = corners[:, :, KUHN]  # (ncell, nz, 6, 4)
        self.hex_tets = np.arange(tets.shape[0] * self.nz * 6).reshape(len(hi), self.nz, 6)
        tets = tets.reshape(-1, 4)
        vol = signed_volume(self.X, tets)
        flip = vol < 0
        tets[flip] = tets[flip][:, [0, 2, 1, 3]]
        self.tets = tets
        self.tet_cell = np.repeat(np.arange(len(hi)), self.nz * 6)
        self.tet_layer = np.tile(np.repeat(np.arange(self.nz), 6), len(hi))

        # Rim columns: not surrounded by four active cells.
        interior = np.zeros((nx, ny), bool)
        interior[1:-1, 1:-1] = (cell_active[:-1, :-1] & cell_active[1:, :-1] & cell_active[:-1, 1:] & cell_active[1:, 1:])
        rim_col = ~interior[ci, cj]
        self.fixed = (self.node_layer == 0) | rim_col[self.node_col]

        # Front surface triangles (outward = +z), split like the Kuhn faces.
        top = corners[:, -1, :]
        a, b, c_, d = top[:, 4], top[:, 5], top[:, 6], top[:, 7]  # (00,10,01,11) at dz = 1
        tt = np.concatenate([np.stack([a, b, d], 1), np.stack([a, d, c_], 1)])
        p0, p1, p2 = self.X[tt[:, 0]], self.X[tt[:, 1]], self.X[tt[:, 2]]
        back = np.cross(p1 - p0, p2 - p0)[:, 2] < 0  # mirrored cells
        tt[back] = tt[back][:, [0, 2, 1]]
        self.top_tris = tt

        self.material = np.full(len(tets), MARGIN, np.int8)
        self.side = np.zeros(len(tets), np.int8)
        self.growth_w = np.zeros(len(tets))

    @property
    def n_nodes(self):
        return len(self.X)

    def tet_centroids(self, X=None):
        X = self.X if X is None else X
        return X[self.tets].mean(axis=1)

    def _columns(self, Pb):
        g = self.grid
        fi = (Pb[:, 0] - g.x0) / g.h
        fj = (Pb[:, 1] - g.y0) / g.h
        i = np.floor(fi).astype(np.int64)
        j = np.floor(fj).astype(np.int64)
        ok = (i >= 0) & (i < g.nx - 1) & (j >= 0) & (j < g.ny - 1)
        cid = np.full(len(Pb), -1, np.int64)
        cid[ok] = self.cell_id[i[ok], j[ok]]
        return fi, fj, i, j, cid

    def surface_heights(self, Pb):
        """(z_bot, z_top) of the extrusion at the x/y of each point (NaN outside)."""
        X = self.X
        Pb = np.asarray(Pb, float)
        fi, fj, i, j, cid = self._columns(Pb)
        out = np.full((len(Pb), 2), np.nan)
        idx = np.nonzero(cid >= 0)[0]
        if len(idx):
            zl, _ = self._layer_heights(X, fi[idx], fj[idx], i[idx], j[idx])
            out[idx, 0], out[idx, 1] = zl[:, 0], zl[:, -1]
        return out

    def _layer_heights(self, X, fi, fj, i, j):
        u = np.clip(fi - i, 0, 1)
        v = np.clip(fj - j, 0, 1)
        L = self.nz + 1
        m = self.cell_mirror[self.cell_id[i, j]]
        u = np.where(m, 1 - u, u)  # local (possibly mirrored) cell coordinates
        i0, i1 = np.where(m, i + 1, i), np.where(m, i, i + 1)
        cols = np.stack([self.col_id[i0, j], self.col_id[i1, j], self.col_id[i0, j + 1], self.col_id[i1, j + 1]], 1)
        # Triangle of the Kuhn face split (diagonal 00-11).
        lower = u >= v
        w = np.where(lower[:, None],
                     np.stack([1 - u, u - v, np.zeros_like(u), v], 1),
                     np.stack([1 - v, np.zeros_like(u), v - u, u], 1))
        # Layer surface heights at (u, v): (m, L)
        return np.einsum('mc,mcl->ml', w, X[cols[:, :, None] * L + np.arange(L)[None, None, :], 2]), cols

    def locate(self, Pb):
        """Tet index and barycentric coordinates of body-frame points.

        Points outside the extrusion vertically are clamped onto the front
        surface / chest wall first, so data just above the skin (clothing
        layers, shell samples) inherits the surface value: constant
        extrapolation along the extrusion axis. Points outside the active
        cells get tet = -1. Also returns z - z_clamped (> 0 above the skin).
        Works on the authored node positions (vertical column edges)."""
        X = self.X
        Pb = np.asarray(Pb, float)
        n = len(Pb)
        fi, fj, i, j, cid = self._columns(Pb)
        ok = cid >= 0
        tet = np.full(n, -1, np.int64)
        bary = np.zeros((n, 4))
        clamped = np.zeros(n)
        if not ok.any():
            return tet, bary, clamped
        idx = np.nonzero(ok)[0]
        zl, _ = self._layer_heights(X, fi[idx], fj[idx], i[idx], j[idx])
        z = Pb[idx, 2]
        zc = np.clip(z, zl[:, 0], zl[:, -1])
        clamped[idx] = z - zc
        k = np.clip((zc[:, None] >= zl[:, 1:-1]).sum(1), 0, self.nz - 1)
        cand = self.hex_tets[cid[idx], k]  # (m, 6)
        q = Pb[idx].copy()
        q[:, 2] = zc
        b6 = barycentric(X, self.tets[cand.reshape(-1)], np.repeat(q, 6, axis=0)).reshape(-1, 6, 4)
        best = np.argmax(b6.min(axis=2), axis=1)
        tet[idx] = cand[np.arange(len(idx)), best]
        bb = b6[np.arange(len(idx)), best]
        bary[idx] = bb / bb.sum(1, keepdims=True)
        return tet, bary, clamped

    def interpolate(self, tet, bary, U):
        """Interpolate nodal field U (N, d) at located points (tet == -1 -> 0)."""
        out = np.zeros((len(tet),) + U.shape[1:])
        ok = tet >= 0
        out[ok] = np.einsum('mk,mk...->m...', bary[ok], U[self.tets[tet[ok]]])
        return out


def signed_volume(X, tets):
    a, b, c, d = (X[tets[:, k]] for k in range(4))
    return np.einsum('ij,ij->i', np.cross(b - a, c - a), d - a) / 6.0


def barycentric(X, tets, P):
    a, b, c, d = (X[tets[:, k]] for k in range(4))
    D = np.stack([b - a, c - a, d - a], axis=2)  # columns
    l = np.linalg.solve(D, (P - a)[:, :, None])[:, :, 0]
    return np.concatenate([1 - l.sum(1, keepdims=True), l], 1)


def _largest_component(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, index=np.arange(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))


def build_from_bind(bind, cfg):
    """Proxy volume of both breasts of a bust-bind/1 export.

    cfg: the 'volume' section of the teacher config. Returns (volume, info)
    where info holds the height maps and footprint geometry (for checks)."""
    fr = bind.frame
    P = bind.params
    W = P['window']
    a = P['anchor']
    h = cfg['cell']
    skin_mats = cfg.get('skinMaterials')
    env_mats = cfg.get('envelopeMaterials')
    sc = cfg['footprintScale']

    # Domain: union of the two field windows (around the base centre; the
    # apex has the same x/y, field.js createBustField).
    cx, cy = a['x'], a['y']
    grid = Grid.covering(-(cx + W['x']), cx + W['x'], cy - W['yDown'], cy + W['yUp'], h)
    E = np.full((grid.nx, grid.ny), -np.inf)
    Es = np.full((grid.nx, grid.ny), -np.inf)
    for m in bind.meshes:
        B = fr.to_body(m.positions)
        both = None if (skin_mats is None and env_mats is None) else list(skin_mats or []) + list(env_mats or [])
        E = np.maximum(E, rasterize_max(grid, B, m.select_triangles(both)))
        if skin_mats is not None:
            Es = np.maximum(Es, rasterize_max(grid, B, m.select_triangles(skin_mats)))
    if skin_mats is None:
        Es = E.copy()

    X, Y = grid.node_xy()
    in_win = np.zeros_like(X, bool)
    r_fp = np.full(X.shape, np.inf)
    side_of = np.where(X >= 0, 1, -1)
    for s in (1, -1):
        rw = ellipse_radius(s * X, Y, cx, cy, W['x'], W['yUp'], W['yDown'])
        in_win |= rw < 1
        r_fp = np.minimum(r_fp, ellipse_radius(s * X, Y, cx, cy, sc * W['x'], sc * W['yUp'], sc * W['yDown']))
    base_z = a['z']
    seen = in_win & np.isfinite(E) & (E > base_z - W['zBack'])
    # Holes in the clothing (openings, deleted faces) show the back of the
    # torso; patch enclosed ones with a membrane fill so they don't cut the
    # volume apart. Regions open to the border (beyond the torso sides) stay out.
    covered = ndimage.binary_fill_holes(seen)
    holes = covered & ~seen
    if holes.any():
        E = np.where(covered, harmonic_fill(np.where(seen, E, 0.0), seen, covered), E)
        Es = np.where(holes, -np.inf, Es)
    # Steep columns at the silhouette (side of the torso, where the surface
    # turns away from the forward axis) make sliver hexes, and the field
    # window has decayed there: trim them. Steep spots enclosed by the
    # domain (inframammary overhang, deep cleavage) are kept, since the
    # extrusion stays valid for any slope (see module doc).
    Ez = np.where(covered, E, np.nan)
    with np.errstate(invalid='ignore'):
        gx = np.abs(np.diff(Ez, axis=0)) / h
        gy = np.abs(np.diff(Ez, axis=1)) / h
    steep = np.zeros_like(covered)
    steep[:-1] |= gx > cfg['maxSlope']
    steep[1:] |= gx > cfg['maxSlope']
    steep[:, :-1] |= gy > cfg['maxSlope']
    steep[:, 1:] |= gy > cfg['maxSlope']
    valid = covered & ~steep

    def cells_of(mask):
        return mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]

    cells = _largest_component(cells_of(valid))
    cells = ndimage.binary_fill_holes(cells) & cells_of(covered)
    active = np.zeros_like(valid)
    for di in (0, 1):
        for dj in (0, 1):
            active[di:grid.nx - 1 + di, dj:grid.ny - 1 + dj] |= cells

    # Chest wall: membrane fill of the surface around the footprints. Inside
    # the midline band, cloth that bridges the cleavage is not body surface.
    skin_top = Es >= E - 1e-4
    band = np.abs(X) < P.get('midline', 0.1)
    known = active & (r_fp >= 1) & (~band | skin_top)
    fill = harmonic_fill(np.where(active, E, 0.0), known, active)
    z_top = np.where(active, E, 0.0)
    z_bot = np.where(active, fill - cfg['wallOffset'], 0.0)
    z_bot = np.minimum(z_bot, z_top - cfg['minThickness'])
    vol = ProxyVolume(grid, z_top, z_bot, cells, cfg['layers'])

    # Materials per tet from the tet centroid.
    C = vol.tet_centroids()
    ci = np.clip(np.round((C[:, 0] - grid.x0) / h).astype(int), 0, grid.nx - 1)
    cj = np.clip(np.round((C[:, 1] - grid.y0) / h).astype(int), 0, grid.ny - 1)
    side = np.where(C[:, 0] >= 0, 1, -1)
    rt = ellipse_radius(side * C[:, 0], C[:, 1], cx, cy, sc * W['x'], sc * W['yUp'], sc * W['yDown'])
    filler_node = active & ~known & (r_fp >= 1)
    mat = np.full(len(C), MARGIN, np.int8)
    mat[filler_node[ci, cj]] = FILLER
    mat[rt < 1] = TISSUE
    vol.material = mat
    vol.side = np.where(mat == TISSUE, side, 0).astype(np.int8)
    vol.growth_w = np.where(mat == TISSUE, falloff(rt, cfg['growthCore']), 0.0)
    vol.footprint = {'cx': cx, 'cy': cy, 'rx': sc * W['x'], 'ryUp': sc * W['yUp'], 'ryDown': sc * W['yDown']}
    info = {'grid': grid, 'E': E, 'Es': Es, 'fill': fill, 'known': known, 'active': active,
            'r_fp': r_fp, 'side_of': side_of}
    return vol, info
