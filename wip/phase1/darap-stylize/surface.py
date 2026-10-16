"""Welded triangle surface built from material groups of a bust-bind/1 export.

Game meshes split vertices on UV / normal seams and MMD models stitch the
skin to the tight top with coincident vertices (Changli: 'UP_Skin' and 'UP'
share 1441 positions and 2356 identical triangles). ARAP needs one manifold
sheet, so vertices are welded by position (union-find on a KD-tree radius
query, robust to rounding straddles), duplicate triangles are dropped and
winding is made to agree with the exported shading normals.
"""

import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree


class Surface:
    """V (n,3) bind-space positions, F (m,3) welded triangles.

    `members_mesh`, `members_vid`, `members_wid` list every original vertex
    (mesh index in the export, vertex index in that mesh) and its welded id;
    `rep_mesh`, `rep_vid` give one representative original vertex per welded
    vertex.
    """

    def __init__(self, V, F, members_mesh=None, members_vid=None, members_wid=None, shading_normals=None, stats=None):
        self.V = np.asarray(V, float)
        self.F = np.asarray(F, np.int64)
        n = len(self.V)
        self.members_mesh = np.zeros(n, np.int64) if members_mesh is None else np.asarray(members_mesh, np.int64)
        self.members_vid = np.arange(n) if members_vid is None else np.asarray(members_vid, np.int64)
        self.members_wid = np.arange(n) if members_wid is None else np.asarray(members_wid, np.int64)
        first = np.full(n, -1, np.int64)
        order = np.argsort(self.members_wid, kind='stable')
        w_sorted = self.members_wid[order]
        starts = np.r_[0, np.nonzero(np.diff(w_sorted))[0] + 1]
        first[w_sorted[starts]] = order[starts]
        self.rep_mesh = self.members_mesh[first]
        self.rep_vid = self.members_vid[first]
        self.shading_normals = shading_normals
        self.stats = stats or {}

    @property
    def n(self):
        return len(self.V)


def weld(P, tol):
    """Cluster points closer than `tol` (transitively). Returns (labels, count)."""
    tree = cKDTree(P)
    pairs = tree.query_pairs(tol, output_type='ndarray')
    n = len(P)
    if len(pairs) == 0:
        return np.arange(n), n
    A = sp.coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    ncomp, lab = connected_components(A, directed=False)
    # relabel by first occurrence so welded ids follow the input order
    _, first = np.unique(lab, return_index=True)
    remap = np.empty(ncomp, np.int64)
    remap[np.argsort(first)] = np.arange(ncomp)
    return remap[lab], ncomp


def build_surface(bind, materials, weld_tol=1e-5):
    """Welded, deduplicated, consistently wound surface of the given materials
    over all meshes of `bind` (weld_tol in S units)."""
    S = bind.frame.S
    Ps, Ns, mesh_ids, vids, tris_g = [], [], [], [], []
    offset = 0
    for m in bind.meshes:
        tris = m.select_triangles(materials)
        if len(tris) == 0:
            continue
        verts = np.unique(tris)
        loc = np.full(len(m.positions), -1, np.int64)
        loc[verts] = np.arange(len(verts)) + offset
        Ps.append(m.positions[verts])
        Ns.append(m.normals[verts] if m.normals is not None else np.zeros((len(verts), 3)))
        mesh_ids.append(np.full(len(verts), m.index_in_file))
        vids.append(verts)
        tris_g.append(loc[tris])
        offset += len(verts)
    if not Ps:
        raise ValueError(f'no triangles with materials {materials}')
    P = np.concatenate(Ps)
    N = np.concatenate(Ns)
    T = np.concatenate(tris_g)
    lab, nw = weld(P, weld_tol * S)
    V = np.zeros((nw, 3))
    V[lab] = P  # coincident within tol: any member is fine
    Nw = np.zeros((nw, 3))
    np.add.at(Nw, lab, N)

    F = lab[T]
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    degenerate = int((~ok).sum())
    F, T = F[ok], T[ok]
    _, keep = np.unique(np.sort(F, 1), axis=0, return_index=True)
    keep.sort()
    duplicates = len(F) - len(keep)
    F, T = F[keep], T[keep]
    # Wind every triangle like the shading normals of its own corners.
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    ref = N[T].sum(1)
    flip = np.einsum('ij,ij->i', fn, ref) < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    # zero-area triangles carry no ARAP energy and break cotangents
    area = 0.5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    tiny = area <= (1e-12 * S * S)
    F = F[~tiny]
    stats = {
        'materials': list(materials) if materials is not None else None,
        'input_vertices': int(len(P)),
        'welded_vertices': int(nw),
        'triangles': int(len(F)),
        'degenerate_after_weld': degenerate,
        'duplicate_triangles': int(duplicates),
        'flipped_to_match_normals': int(flip.sum()),
        'zero_area': int(tiny.sum()),
        'nonmanifold_edges': int(nonmanifold_edges(F)),
    }
    nl = np.linalg.norm(Nw, axis=1, keepdims=True)
    return Surface(V, F, np.concatenate(mesh_ids), np.concatenate(vids), lab, Nw / np.where(nl > 0, nl, 1), stats)


# --- per-mesh geometry -----------------------------------------------------------


def edges_of(F):
    return np.concatenate([F[:, [1, 2]], F[:, [2, 0]], F[:, [0, 1]]])


def nonmanifold_edges(F):
    E = np.sort(edges_of(F), 1)
    _, c = np.unique(E, axis=0, return_counts=True)
    return (c > 2).sum()


def face_normals(V, F, unit=True):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if not unit:
        return n
    l = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(l > 0, l, 1)


def vertex_normals(V, F):
    """Area-weighted vertex normals (sum of face cross products)."""
    fn = face_normals(V, F, unit=False)
    N = np.zeros_like(V, dtype=float)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    l = np.linalg.norm(N, axis=1, keepdims=True)
    return N / np.where(l > 0, l, 1)


def lumped_area(V, F):
    a = 0.5 * np.linalg.norm(face_normals(V, F, unit=False), axis=1)
    A = np.zeros(len(V))
    for k in range(3):
        np.add.at(A, F[:, k], a / 3)
    return A


def adjacency(F, n):
    E = edges_of(F)
    A = sp.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n)).tocsr()
    return ((A + A.T) > 0).astype(np.int8)


def angle_deg(a, b):
    """Angle between rows of a and b, degrees."""
    c = np.einsum('ij,ij->i', a, b) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) + 1e-300)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def closest_points(V, F, Q, k=8):
    """Closest point on the triangle surface for every query point.

    Candidate triangles are those incident to the k nearest vertices (enough
    for well-shaped meshes and queries near the surface). Returns
    (triangle id, barycentric (q,3), distance).
    """
    tree = cKDTree(V)
    _, nv = tree.query(Q, k=min(k, len(V)))
    nv = np.atleast_2d(nv)
    # vertex -> incident triangles (CSR)
    rows = F.ravel()
    cols = np.repeat(np.arange(len(F)), 3)
    VT = sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(V), len(F)))
    best_t = np.full(len(Q), -1, np.int64)
    best_b = np.zeros((len(Q), 3))
    best_d = np.full(len(Q), np.inf)
    for qi in range(len(Q)):
        cand = np.unique(VT[nv[qi]].indices)
        if len(cand) == 0:
            continue
        b, d = _point_triangle(Q[qi], V[F[cand, 0]], V[F[cand, 1]], V[F[cand, 2]])
        j = np.argmin(d)
        best_t[qi], best_b[qi], best_d[qi] = cand[j], b[j], d[j]
    return best_t, best_b, best_d


def _point_triangle(p, a, b, c):
    """Closest point from p to each triangle (a,b,c rows): barycentrics, distance.
    (Ericson, Real-Time Collision Detection, 5.1.5, vectorised.)"""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = np.einsum('ij,ij->i', ab, ap), np.einsum('ij,ij->i', ac, ap)
    bp = p - b
    d3, d4 = np.einsum('ij,ij->i', ab, bp), np.einsum('ij,ij->i', ac, bp)
    cp = p - c
    d5, d6 = np.einsum('ij,ij->i', ab, cp), np.einsum('ij,ij->i', ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    n = len(a)
    bary = np.zeros((n, 3))
    done = np.zeros(n, bool)

    def put(mask, u, v, w):
        m = mask & ~done
        bary[m] = np.stack([u, v, w], 1)[m] if np.ndim(u) else np.array([u, v, w])
        done[m] = True

    one, zero = np.ones(n), np.zeros(n)
    put((d1 <= 0) & (d2 <= 0), one, zero, zero)
    put((d3 >= 0) & (d4 <= d3), zero, one, zero)
    put((d6 >= 0) & (d5 <= d6), zero, zero, one)
    with np.errstate(divide='ignore', invalid='ignore'):
        v_ab = d1 / (d1 - d3)
        put((vc <= 0) & (d1 >= 0) & (d3 <= 0), 1 - v_ab, v_ab, zero)
        w_ac = d2 / (d2 - d6)
        put((vb <= 0) & (d2 >= 0) & (d6 <= 0), 1 - w_ac, zero, w_ac)
        w_bc = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        put((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), zero, 1 - w_bc, w_bc)
        den = va + vb + vc
        v_in = vb / den
        w_in = vc / den
        put(np.ones(n, bool), 1 - v_in - w_in, v_in, w_in)
    bary = np.nan_to_num(bary)
    q = bary[:, :1] * a + bary[:, 1:2] * b + bary[:, 2:] * c
    return bary, np.linalg.norm(q - p, axis=1)
