// Analytic torso front surface with two breast mounds, tessellated at any
// resolution, for the morphometric tests (web/test/morpho.test.js and the
// Python mirror in tools/morpho). Body frame with S = 1: x = left, y = up,
// z = forward. Every vertex lies exactly on the same smooth surface, so a finer
// tessellation is a true refinement of a coarser one.
//
// Mound types (left side; the right side is mirrored):
//   'cap'      spherical-cap profile over an elliptic radius with separate
//              upper / lower / medial / lateral radii (tilt and divergence
//              come from the asymmetry), rim slope bounded by `R`, crease
//              softened by a softplus of width k. Bounded slopes everywhere,
//              so a coarse grid represents it well: the resolution test shape.
//   'profile'  extruded sagittal profile H(y) * W(x) with a chosen upper-pole
//              shape (concave / straight / convex) for the convexity tests.

export const SYNTH_DEFAULTS = {
  x: [-0.65, 0.65],
  y: [-0.4, 0.95],
  h: 0.02, // grid spacing
  jitter: 0, // random in-plane vertex offset (fraction of h) -> irregular mesh
  seed: 1,
  type: 'cap',
  xc: 0.27, yc: 0.27, // apex position (x of the left mound)
  P: 0.14, // protrusion over the chest surface
  aLat: 0.15, aMed: 0.14, bUp: 0.15, bLo: 0.16, // radii
  R: 1.4, // cap sphere radius in units of the base radius (> 1; larger = flatter rim)
  k: 0.02, // crease softness
  upper: 'convex', // 'profile' type: 'concave' | 'straight' | 'convex'
  flatChest: false, // true: chest is the plane z = 0.18 (exact symmetry tests)
};

export function chestZ(x, y) {
  const t = Math.max(0, y - 0.45);
  return 0.18 - 0.6 * x * x - 0.08 * (y - 0.2) * (y - 0.2) - 0.25 * t * t;
}

// Spherical cap 1 at r = 0, 0 at r = 1, continued linearly below 0 for r > 1
// (so the softplus blend has something to fade into).
function cap(r, R) {
  const s1 = Math.sqrt(R * R - 1);
  const top = R - s1;
  if (r <= 1) return (Math.sqrt(R * R - r * r) - s1) / top;
  return (-(r - 1)) / (s1 * top);
}

function softplus(v, k) {
  return v > 0 ? v + k * Math.log1p(Math.exp(-v / k)) : k * Math.log1p(Math.exp(v / k));
}

function moundCap(x, y, m, side) {
  const dx = side * x - m.xc, dy = y - m.yc;
  const a = dx >= 0 ? m.aLat : m.aMed, b = dy >= 0 ? m.bUp : m.bLo;
  const r = Math.sqrt((dx / a) * (dx / a) + (dy / b) * (dy / b));
  return m.P * cap(r, m.R);
}

function moundProfile(x, y, m, side) {
  const dx = side * x - m.xc, dy = y - m.yc;
  let H;
  if (dy >= 0) {
    const t = Math.min(dy / m.bUp, 1.5);
    const f = m.upper === 'concave' ? (1 - t) * (1 - t) * Math.sign(1 - t) : m.upper === 'straight' ? 1 - t : 1 - t * t;
    H = m.P * f;
  } else {
    const t = -dy / m.bLo; // convex lower pole (quarter ellipse continued linearly)
    H = t <= 0.95 ? m.P * Math.sqrt(1 - t * t) : m.P * (Math.sqrt(1 - 0.95 * 0.95) - ((t - 0.95) * 0.95) / Math.sqrt(1 - 0.95 * 0.95));
  }
  const w = 1 - (dx / m.aLat) * (dx / m.aLat);
  return H * Math.max(w, -1) + (w < 0 ? w * m.P : 0);
}

export function surfaceZ(x, y, m) {
  const f = m.type === 'profile' ? moundProfile : moundCap;
  const c = m.flatChest ? 0.18 : chestZ(x, y);
  // the two mounds never overlap enough to need more than the larger one
  const v = Math.max(f(x, y, m, 1), f(x, y, m, -1));
  return c + softplus(v, m.k);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296 - 0.5;
  };
}

/** Grid tessellation: {pos: Float64Array, index: Uint32Array, frame, params}. */
export function synthTorso(opts = {}) {
  const m = { ...SYNTH_DEFAULTS, ...opts };
  const nx = Math.round((m.x[1] - m.x[0]) / m.h) + 1, ny = Math.round((m.y[1] - m.y[0]) / m.h) + 1;
  const pos = new Float64Array(nx * ny * 3);
  const rnd = rng(m.seed);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let x = m.x[0] + i * m.h, y = m.y[0] + j * m.h;
      if (m.jitter && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
        x += rnd() * m.jitter * m.h;
        y += rnd() * m.jitter * m.h;
      }
      const v = (j * nx + i) * 3;
      pos[v] = x;
      pos[v + 1] = y;
      pos[v + 2] = surfaceZ(x, y, m);
    }
  const index = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // alternate diagonals so the triangulation has no global bias
      if ((i + j) % 2 === 0) index.push(a, b, d, a, d, c);
      else index.push(a, b, c, b, d, c);
    }
  return { pos, index: Uint32Array.from(index), frame: SYNTH_FRAME, params: m, apex: [[m.xc, m.yc, 0.3], [-m.xc, m.yc, 0.3]] };
}

export const SYNTH_FRAME = { origin: [0, 0, 0], left: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], S: 1, hipsY: -1, neckY: 1 };

/** Midpoint (1 -> 4) subdivision: identical piecewise-linear surface. */
export function midpointSubdivide(pos, index) {
  const P = Array.from(pos);
  const key = new Map();
  const mid = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let v = key.get(k);
    if (v === undefined) {
      v = P.length / 3;
      P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      key.set(k, v);
    }
    return v;
  };
  const I = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    I.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { pos: Float64Array.from(P), index: Uint32Array.from(I) };
}
