// Bust morphometrics: engine-agnostic shape measurements of a breast mound on
// a triangle mesh, used to compare slider states, teachers and characters, and
// to score shapes against aesthetic bands (natural vs. anime hypothesis).
// decision-v2 3(c)-2 / P1-2. Python mirror: tools/morpho/morpho.py (parity
// tested). Units: S (shoulder-joint distance), body frame of field.js.
//
// Everything is measured on the *outer envelope* of the triangles you pass
// (body skin, optionally plus torso clothes): plane sections are taken through
// the mesh and, at each in-plane coordinate, the front-most (max forward)
// crossing is kept. Sections are sampled exactly on the piecewise-linear
// surface at a fixed spacing in S units, and every landmark comes from a
// least-squares fit or an interpolated crossing over a fixed physical extent,
// never from a picked vertex: that is what keeps the numbers independent of
// the tessellation (web/test/morpho.test.js: coarse vs. 4x finer tessellation
// of the same smooth surface agree within 2%).
//
// Per side, u = outward distance from the midline, y = up, z = forward.
// Sagittal section: plane u = u_A. Transverse section: plane y = y_A.
//
// Landmarks
//   A  apex      most anterior point of the mound: stationary point of a 2D
//                quadratic fit to the front height map around its max cell
//                (gives u_A); y_A, z_A from a 1D quadratic fit on the sagittal
//                profile (capFit half-extent).
//   I  IMF       inframammary fold. Height = the knee of the lower profile:
//                the point farthest behind the chord from A to the profile at
//                y_A - reachDown (centroid of the connected samples within
//                kneeFrac of the max distance, so soft creases are stable).
//                Depth = the chest-wall line fitted just below the knee
//                (foldFit), i.e. the bottom of the fold as if it were sharp: a
//                coarse mesh cuts a rounded crease, the wall it joins is
//                resolution independent.
//   chest wall   coronal plane z = z_I through the IMF; p = z_A - z_I.
//   T, L         upper / lower borders: first point above / below A where the
//                protrusion over the chest wall falls to edgeFrac * p. One rule
//                for both, so a mound symmetric about the horizontal through
//                its apex measures exactly 50:50. Anime upper poles often merge
//                convexly into the shoulder with no crease, which is why the
//                top is not a knee (fallbacks: upper knee, then reach; flagged).
//   axis         cap axis: midpoints of the constant-z chords of the profile at
//                depths f * (z_A - max(z_T, z_L)), f in axisDepths, fitted by a
//                line m(d) = alpha + beta * d. Tilt = atan(-beta): 0 for a cap
//                symmetric about the horizontal through A, > 0 when it points
//                up (the lower pole is fuller / longer than the upper).
//   N  nipple    nipple proxy: where the cap axis leaves the surface. Meshes
//                have no nipple; N is where the mound points from, which is
//                what Mallucci's nipple meridian refers to. N = A for a
//                symmetric cap.
//
// Metrics
//   upperPoleFrac   (y_T - y_N) / (y_T - y_L): Mallucci & Branford's UP:LP,
//                   split by the horizontal through the nipple (0.45 = 45:55).
//   tiltDeg         cap axis angle above horizontal (apex tilt proxy).
//   upperSlopeDeg   angle below horizontal of the upper pole chord between the
//                   poleDepth crossings (90 = vertical, small = shelf-like).
//   upperConvexity  upper pole between the crossings at depths poleDepth of the
//                   protrusion: quadratic fit z(y), perpendicular deviation of
//                   the fit at mid-arc from its chord / chord length. > 0
//                   convex (bulges outward), < 0 concave. upperShape = concave
//                   / straight / convex with |s| <= straightTol as straight.
//                   Depth crossings sit on steep flanks, so this does not move
//                   with the (soft) borders.
//   lowerConvexity  same for the lower pole.
//   imfY            IMF height in the body frame (relative to the chest joint);
//                   imfDrop = shoulderY - imfY when shoulderY is given; imfFrac
//                   = position between hips and neck (rig dependent: MMD hips
//                   sit at the waist).
//   projection      p. baseHeight = y_T - y_L.
//   baseWidth       transverse section: medial border (first point toward the
//                   midline at the wall threshold, else the valley floor) to the
//                   lateral border (same threshold). Missing when the lateral
//                   border is not found within reachLat or the transverse cap
//                   is shallower than minTransverse * p (a garment bridging the
//                   cleavage turns both breasts into one arch: no width and no
//                   direction to measure).
//   projectionRatio p / baseWidth.
//   divergenceDeg   transverse cap axis angle from straight forward, > 0 when
//                   the mound points outward (same chord-midpoint method).
//   turnDeg         angle between the upper and lower pole chords: how much the
//                   profile turns across the cap (0 = flat).
//
// Flags (result.sides[i].flags) explain fallbacks; a side is `ok` unless it is
// flat, has a hole (e.g. skin cut out under a garment: the envelope falls
// through to the back of the torso), its apex is stuck on the search edge, or
// the fold / top border was not found within reach (NOT_OK). Means and band
// scores use ok sides only.

const DEG = 180 / Math.PI;

export const MORPHO_DEFAULTS = {
  step: 0.0025, // section sample spacing (S)
  cell: 0.005, // height-map cell for the apex search (S)
  search: 0.2, // apex search radius around the estimate (S)
  capFit: 0.05, // half-extent of the quadratic fits locating the apex (S)
  reachUp: 0.4, // profile extent above / below the apex used for borders (S)
  reachDown: 0.35,
  reachLat: 0.3, // transverse extent beyond the apex (S)
  kneeFrac: 0.9, // knee = centroid of samples within this fraction of the max
  kneeFit: 0.03, // ... restricted to this distance from the max sample (S)
  foldFit: [0.015, 0.06], // IMF depth: chest-wall line fitted this far below the knee (S)
  foldMinDeg: 20, // ... used only if the two lines differ by at least this angle
  edgeFrac: 0.1, // border = where protrusion over the chest wall < edgeFrac * p
  // chord depths for the cap axis (fractions of the protrusion over the
  // shallower border); dense, so the facet ripple of coarse meshes averages out
  axisDepths: Array.from({ length: 17 }, (_, i) => 0.2 + 0.025 * i),
  poleDepth: [0.15, 0.7], // pole shape is measured between these depth fractions
  straightTol: 0.01, // |sagitta ratio| <= this counts as straight
  minProjection: 0.02, // below this the chest counts as flat (S)
  minTransverse: 0.3, // transverse cap must be this deep (x p) to give a divergence
  holeJump: 0.15, // envelope jump between samples that counts as a hole (S):
  // far more than a garment edge stepping down to the skin (~0.01-0.08), far
  // less than falling through to the back of the torso (~0.5)
  minMask: 0.5, // triangles with a vertex mask below this are ignored
  margin: 0.15, // extra region kept around the bust for deformed states (S)
};

// Human-readable metric list (order = table order). `pct` metrics are
// fractions shown in percent.
export const METRICS = [
  { key: 'upperPoleFrac', label: 'UP:LP upper share', unit: '%', pct: true },
  { key: 'tiltDeg', label: 'apex tilt', unit: 'deg' },
  { key: 'upperSlopeDeg', label: 'upper pole slope', unit: 'deg' },
  { key: 'upperConvexity', label: 'upper pole convexity', unit: '' },
  { key: 'lowerConvexity', label: 'lower pole convexity', unit: '' },
  { key: 'imfY', label: 'IMF height', unit: 'S' },
  { key: 'projection', label: 'projection', unit: 'S' },
  { key: 'baseWidth', label: 'base width', unit: 'S' },
  { key: 'baseHeight', label: 'base height', unit: 'S' },
  { key: 'projectionRatio', label: 'projection / base width', unit: '' },
  { key: 'divergenceDeg', label: 'lateral divergence', unit: 'deg' },
  { key: 'turnDeg', label: 'profile turn', unit: 'deg' },
];

// Aesthetic bands as data. Each metric: [lo, hi] inside = distance 0; outside
// the distance is (gap / scale), combined as a weighted RMS (scoreBands).
// imfRise = imfY - reference.imfY, only scored when a reference (usually the
// unmodified base mesh) is given: absolute IMF heights are not comparable
// across rigs and S-normalized anime proportions.
export const BANDS = {
  natural: {
    label: 'natural (Mallucci & Branford 2012)',
    source:
      'Mallucci & Branford, "Concepts in aesthetic breast dimensions: analysis of the ideal breast", JPRAS 2012: ' +
      'UP:LP 45:55, nipple pointing ~20 deg above horizontal, straight/slightly concave upper pole, convex lower pole. ' +
      'Measured on photos with a visible nipple; tiltDeg here is a cap-axis proxy, so the 20 deg mapping is an assumption.',
    metrics: {
      upperPoleFrac: { lo: 0.42, hi: 0.48, scale: 0.05, weight: 1 },
      tiltDeg: { lo: 15, hi: 25, scale: 10, weight: 1 },
      upperConvexity: { lo: -0.04, hi: 0.01, scale: 0.02, weight: 1 },
      lowerConvexity: { lo: 0.01, hi: 0.12, scale: 0.02, weight: 1 },
      imfRise: { lo: -0.05, hi: 0.0, scale: 0.02, weight: 0.5 },
    },
  },
  anime: {
    label: 'anime (hypothesis)',
    hypothesis: true,
    source:
      'decision-v2 3(c)-2: ~50:50, tilt 25-30 deg, slightly convex upper pole, higher IMF. Unvalidated: ' +
      'to be replaced by a measured distribution (critique-v2 3.1) and checked with AD preference sessions.',
    metrics: {
      upperPoleFrac: { lo: 0.47, hi: 0.53, scale: 0.05, weight: 1 },
      tiltDeg: { lo: 25, hi: 30, scale: 10, weight: 1 },
      upperConvexity: { lo: 0.01, hi: 0.05, scale: 0.02, weight: 1 },
      lowerConvexity: { lo: 0.01, hi: 0.12, scale: 0.02, weight: 1 },
      imfRise: { lo: 0.0, hi: 0.05, scale: 0.02, weight: 0.5 },
    },
  },
};

/**
 * Distance of a metrics object (one side or the mean) to a band.
 * @param {object} m metrics (e.g. result.mean)
 * @param {object} band BANDS.natural / BANDS.anime / custom
 * @param {{reference?: object}} [o] reference metrics for relative terms (imfRise)
 * @returns {{distance: number|null, inside: boolean, per: object, missing: string[]}}
 */
export function scoreBands(m, band, { reference = null } = {}) {
  let acc = 0, sw = 0, inside = true;
  const per = {}, missing = [];
  for (const [k, b] of Object.entries(band.metrics)) {
    let v = m?.[k];
    if (k === 'imfRise') v = reference && isNum(m?.imfY) && isNum(reference.imfY) ? m.imfY - reference.imfY : null;
    if (!isNum(v)) {
      missing.push(k);
      continue;
    }
    const d = Math.max(0, b.lo - v, v - b.hi) / b.scale;
    per[k] = { value: v, lo: b.lo, hi: b.hi, d };
    acc += b.weight * d * d;
    sw += b.weight;
    if (d > 0) inside = false;
  }
  return { distance: sw > 0 ? Math.sqrt(acc / sw) : null, inside: sw > 0 && inside, per, missing };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------ inputs

/**
 * Triangle index (flat Uint32Array) of the material groups whose name passes
 * include/exclude. Groups use three.js / bust-bind/1 ranges into `index`
 * (start/count in index entries); overlapping groups (outline passes) are
 * counted once. No groups -> every triangle.
 */
export function selectTriangles(index, vertexCount, groups, { include = null, exclude = null } = {}) {
  const idx = index ?? Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const nt = Math.floor(idx.length / 3);
  if (!groups || groups.length === 0) return Uint32Array.from(idx.subarray ? idx.subarray(0, nt * 3) : idx.slice(0, nt * 3));
  const keep = new Uint8Array(nt);
  for (const g of groups) {
    const name = g.material ?? '';
    if (include && !include.test(name)) continue;
    if (exclude && exclude.test(name)) continue;
    const t0 = Math.floor(g.start / 3), t1 = Math.min(nt, Math.floor((g.start + (Number.isFinite(g.count) ? g.count : idx.length)) / 3));
    for (let t = t0; t < t1; t++) keep[t] = 1;
  }
  let n = 0;
  for (let t = 0; t < nt; t++) n += keep[t];
  const out = new Uint32Array(n * 3);
  let o = 0;
  for (let t = 0; t < nt; t++) {
    if (!keep[t]) continue;
    out[o++] = idx[t * 3];
    out[o++] = idx[t * 3 + 1];
    out[o++] = idx[t * 3 + 2];
  }
  return out;
}

// Default material filters: torso skin, and torso skin + clothes without hair,
// face, small accessories (metal, tassels, bows...) and limbs.
export const SKIN_MATERIALS = /skin|body/i;
export const NON_TORSO_MATERIALS = /hair|face|eye|brow|lash|mouth|teeth|tongue|nose|metal|liusu|tassel|star|pin|bow|shoe|sock|arm|leg|hand|glove|表情/i;

/**
 * Precompute everything that does not depend on the slider weights: body-space
 * coordinates (S units) of the vertices near the bust, the triangles to
 * section, and body-space deltas per target. Use with measurePrepared(); the
 * viewer HUD keeps one of these per bake.
 *
 * @param {object} a
 * @param {object} a.frame body frame (buildBodyFrame), bind space
 * @param {Array<{pos: ArrayLike<number>, tris?: ArrayLike<number>, index?: ArrayLike<number>|null,
 *                mask?: ArrayLike<number>|null, deltas?: Object<string, ArrayLike<number>>}>} a.meshes
 *        bind-space positions; `tris` = triangle list to measure (default: index
 *        or sequential); deltas in bind space (same layout as pos).
 * @param {number[][]} a.apex apex estimates [left, right] in bind space (e.g.
 *        field.sides.map(s => s.apex)); sides are s = +1 (left), -1 (right).
 * @param {object} [a.opts] overrides of MORPHO_DEFAULTS
 * @param {number} [a.shoulderY] shoulder (upper-arm joint) height in the body
 *        frame, S units, for imfDrop
 */
export function prepareMorpho({ frame, meshes, apex, opts = {}, shoulderY = null }) {
  const o = { ...MORPHO_DEFAULTS, ...opts };
  const S = frame.S;
  const toB = (p) => {
    const dx = p[0] - frame.origin[0], dy = p[1] - frame.origin[1], dz = p[2] - frame.origin[2];
    return [
      (dx * frame.left[0] + dy * frame.left[1] + dz * frame.left[2]) / S,
      (dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2]) / S,
      (dx * frame.forward[0] + dy * frame.forward[1] + dz * frame.forward[2]) / S,
    ];
  };
  const est = apex.map(toB);
  // Region that can matter for any slider state: the reach of every section
  // around both apex estimates plus a margin for the deformation itself.
  const yLo = Math.min(est[0][1], est[1][1]) - Math.max(o.search, o.reachDown) - o.margin;
  const yHi = Math.max(est[0][1], est[1][1]) + Math.max(o.search, o.reachUp) + o.margin;
  const xMax = Math.max(Math.abs(est[0][0]), Math.abs(est[1][0])) + Math.max(o.search, o.reachLat) + o.margin;

  const keptB = [], keptD = {}, triOut = [];
  let base = 0;
  const targetNames = new Set();
  for (const m of meshes) for (const k of Object.keys(m.deltas ?? {})) targetNames.add(k);
  for (const k of targetNames) keptD[k] = [];
  for (const m of meshes) {
    const n = Math.floor(m.pos.length / 3);
    const tris = m.tris ?? m.index ?? Uint32Array.from({ length: n }, (_, i) => i);
    const B = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) {
      const b = toB([m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]]);
      B[v * 3] = b[0];
      B[v * 3 + 1] = b[1];
      B[v * 3 + 2] = b[2];
    }
    const remap = new Int32Array(n).fill(-1);
    let kept = 0;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      if (m.mask && (m.mask[a] < o.minMask || m.mask[b] < o.minMask || m.mask[c] < o.minMask)) continue;
      const y0 = Math.min(B[a * 3 + 1], B[b * 3 + 1], B[c * 3 + 1]), y1 = Math.max(B[a * 3 + 1], B[b * 3 + 1], B[c * 3 + 1]);
      if (y1 < yLo || y0 > yHi) continue;
      const x0 = Math.min(B[a * 3], B[b * 3], B[c * 3]), x1 = Math.max(B[a * 3], B[b * 3], B[c * 3]);
      if (x1 < -xMax || x0 > xMax) continue;
      for (const v of [a, b, c]) {
        if (remap[v] < 0) {
          remap[v] = base + kept++;
          keptB.push(B[v * 3], B[v * 3 + 1], B[v * 3 + 2]);
          for (const k of targetNames) {
            const d = m.deltas?.[k];
            if (!d) {
              keptD[k].push(0, 0, 0);
              continue;
            }
            const dv = [d[v * 3], d[v * 3 + 1], d[v * 3 + 2]];
            keptD[k].push(
              (dv[0] * frame.left[0] + dv[1] * frame.left[1] + dv[2] * frame.left[2]) / S,
              (dv[0] * frame.up[0] + dv[1] * frame.up[1] + dv[2] * frame.up[2]) / S,
              (dv[0] * frame.forward[0] + dv[1] * frame.forward[1] + dv[2] * frame.forward[2]) / S,
            );
          }
        }
      }
      triOut.push(remap[a], remap[b], remap[c]);
    }
    base += kept;
  }
  const D = {};
  for (const k of targetNames) D[k] = Float64Array.from(keptD[k]);
  const hipsY = frame.hipsY !== undefined ? frame.hipsY / S : null;
  const neckY = frame.neckY !== undefined ? frame.neckY / S : null;
  return { o, S, B: Float64Array.from(keptB), tris: Uint32Array.from(triOut), D, est, shoulderY, hipsY, neckY };
}

/** Body-space positions (S units) for a weight set: B + sum_k w_k D_k. */
export function deformPrepared(ctx, weights = null) {
  if (!weights) return ctx.B;
  const P = Float64Array.from(ctx.B);
  for (const [k, w] of Object.entries(weights)) {
    const d = ctx.D[k];
    if (!d || !w) continue;
    for (let i = 0; i < P.length; i++) P[i] += w * d[i];
  }
  return P;
}

/**
 * Measure both sides for a weight set (null = base mesh).
 * @returns {{sides: object[], mean: object, ok: boolean}}
 */
export function measurePrepared(ctx, weights = null) {
  const P = deformPrepared(ctx, weights);
  const sides = [1, -1].map((s, i) => measureSide(ctx, P, s, ctx.est[i]));
  return { sides, mean: meanMetrics(sides), ok: sides.every((r) => r.ok) };
}

/** One-shot convenience: prepare + measure (weights apply `deltas`). */
export function measureBust(args) {
  return measurePrepared(prepareMorpho(args), args.weights ?? null);
}

const MEAN_KEYS = ['upperPoleFrac', 'upperPoleH', 'lowerPoleH', 'tiltDeg', 'upperSlopeDeg', 'upperConvexity', 'lowerConvexity', 'imfY', 'imfDrop', 'projection', 'baseHeight', 'baseWidth', 'projectionRatio', 'divergenceDeg', 'turnDeg', 'apexY', 'nippleY'];

// Mean over the sides that measured cleanly (holes, flat chests and apexes
// stuck on the search edge give numbers, but not ones to average or score).
function meanMetrics(sides) {
  const out = { ok: sides.some((r) => r.ok) };
  const good = sides.filter((r) => r.ok);
  for (const k of MEAN_KEYS) {
    const v = good.map((r) => r[k]).filter(isNum);
    out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }
  out.upperShape = shapeClass(out.upperConvexity, sides[0]?.straightTol ?? MORPHO_DEFAULTS.straightTol);
  out.lowerShape = shapeClass(out.lowerConvexity, sides[0]?.straightTol ?? MORPHO_DEFAULTS.straightTol);
  out.flags = [...new Set(sides.flatMap((r) => r.flags.map((f) => `${r.side}:${f}`)))];
  return out;
}

function shapeClass(s, tol) {
  if (!isNum(s)) return null;
  return s > tol ? 'convex' : s < -tol ? 'concave' : 'straight';
}

// ------------------------------------------------------------------ one side

function measureSide(ctx, P, s, est) {
  const o = ctx.o;
  const r = { side: s > 0 ? 'L' : 'R', s, ok: false, flags: [], straightTol: o.straightTol };
  const ue = s * est[0], ye = est[1];

  // 1) apex on the front height map
  const hm = heightMapApex(P, ctx.tris, s, ue, ye, o);
  if (!hm) {
    r.flags.push('noSurface');
    return r;
  }
  if (hm.onEdge) r.flags.push('apexOnSearchEdge');
  const uA = hm.u;

  // 2) sagittal profile through the apex
  const y0 = hm.y - o.reachDown - 2 * o.capFit;
  const ny = Math.round((o.reachDown + o.reachUp + 4 * o.capFit) / o.step) + 1;
  const sag = sectionProfile(P, ctx.tris, s, 'u', uA, y0, ny, o.step);
  const iHm = Math.round((hm.y - y0) / o.step);
  const A = profileApex(sag, iHm, o);
  if (!A) {
    r.flags.push('noSagittalApex');
    return r;
  }
  r.apex = [uA, A.u, A.z];
  r.apexY = A.u;
  const iA = clampIdx(Math.round((A.u - y0) / o.step), ny);

  // 3) IMF: knee of the lower profile; depth from the chest wall below it
  const iLow = clampIdx(Math.round((A.u - o.reachDown - y0) / o.step), ny);
  let I = knee(sag, iA, iLow, A, o);
  if (!I) {
    r.flags.push('imfOpen');
    I = endPoint(sag, iLow, iA);
    if (!I) return r;
  } else {
    const c = foldPoint(sag, I, A, o);
    if (c) I = c;
    else r.flags.push('imfSoft');
  }
  const p = A.z - I.z;
  r.projection = p;
  if (!(p > o.minProjection)) r.flags.push('flat');
  // Both borders use the same rule (protrusion over the chest-wall plane
  // falls to edgeFrac * p), so a mound symmetric about the horizontal through
  // its apex measures exactly 50:50.
  const zWall = I.z + o.edgeFrac * Math.max(p, 0);

  // 4) lower border (at or just above the fold) and upper border: profile
  //    recedes to the wall threshold, else the upper knee, else the reach
  let L = scanCross(sag, iA, iLow, zWall);
  if (!L) L = I;
  const iUp = clampIdx(Math.round((A.u + o.reachUp - y0) / o.step), ny);
  let T = scanCross(sag, iA, iUp, zWall);
  if (!T) {
    T = knee(sag, iA, iUp, A, o);
    if (T) r.flags.push('topFromKnee');
    else {
      r.flags.push('topOpen');
      T = endPoint(sag, iUp, iA);
      if (!T) return r;
    }
  }
  const iT = clampIdx(Math.round((T.u - y0) / o.step), ny);
  const iL = clampIdx(Math.round((L.u - y0) / o.step), ny);
  const iI = clampIdx(Math.round((I.u - y0) / o.step), ny);
  if (hasHole(sag, Math.min(iI, iL), iT, o.holeJump)) r.flags.push('hole');

  // 5) cap axis -> tilt and nipple proxy
  // chord depths are fractions of the protrusion over the shallower border,
  // so the deepest chord never ends on a flat (ill-conditioned) stretch
  const ax = capAxis(sag, iA, iT, iL, A, A.z - Math.max(T.z, L.z), o);
  let N = { u: A.u, z: A.z };
  if (ax) {
    r.axis = ax;
    r.tiltDeg = Math.atan(-ax.beta) * DEG;
    const ex = axisExit(sag, ax, A, iA, o);
    if (ex) N = ex;
    else r.flags.push('nippleAtApex');
  } else r.flags.push('noAxis');
  r.nipple = [uA, N.u, N.z];
  r.nippleY = N.u;
  r.top = [T.u, T.z];
  r.bottom = [L.u, L.z];
  r.imf = [I.u, I.z];

  const upH = T.u - N.u, loH = N.u - L.u;
  r.upperPoleH = upH;
  r.lowerPoleH = loH;
  r.baseHeight = T.u - L.u;
  r.upperPoleFrac = upH + loH > 0 ? upH / (upH + loH) : null;
  // pole shape between the depth crossings poleDepth[0..1] of the
  // protrusion (well-conditioned: steep flank, independent of the borders)
  const pz = A.z - Math.max(T.z, L.z);
  const zc0 = A.z - o.poleDepth[0] * pz, zc1 = A.z - o.poleDepth[1] * pz;
  const u0 = scanCross(sag, iA, iT, zc0), u1 = scanCross(sag, iA, iT, zc1);
  const l0 = scanCross(sag, iA, iL, zc0), l1 = scanCross(sag, iA, iL, zc1);
  const exact = (c, zc) => c && c.z === zc;
  if (exact(u0, zc0) && exact(u1, zc1)) {
    r.upperConvexity = arcSagitta(sag, u0, u1);
    r.upperSlopeDeg = Math.atan2(u1.u - u0.u, u0.z - u1.z) * DEG;
  } else r.flags.push('noUpperPole');
  if (exact(l0, zc0) && exact(l1, zc1)) r.lowerConvexity = arcSagitta(sag, l1, l0);
  else r.flags.push('noLowerPole');
  r.upperShape = shapeClass(r.upperConvexity, o.straightTol);
  r.lowerShape = shapeClass(r.lowerConvexity, o.straightTol);
  if (exact(u0, zc0) && exact(u1, zc1) && exact(l0, zc0) && exact(l1, zc1)) {
    // turning of the profile across the cap: upper chord (deep -> shallow)
    // vs lower chord (shallow -> deep); 0 for a flat (straight) profile
    const a = [u0.u - u1.u, u0.z - u1.z], b = [l1.u - l0.u, l1.z - l0.z];
    const la = Math.sqrt(a[0] * a[0] + a[1] * a[1]), lb = Math.sqrt(b[0] * b[0] + b[1] * b[1]);
    if (la > 0 && lb > 0) r.turnDeg = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * DEG;
  }
  r.imfY = I.u;
  r.imfDrop = isNum(ctx.shoulderY) ? ctx.shoulderY - I.u : null;
  if (isNum(ctx.hipsY) && isNum(ctx.neckY) && ctx.neckY > ctx.hipsY) r.imfFrac = (I.u - ctx.hipsY) / (ctx.neckY - ctx.hipsY);

  // 6) transverse section through the apex: base width and divergence
  const x0 = -Math.round(o.capFit / o.step) * o.step; // a little past the midline for the valley fit
  const nx = Math.round((uA + o.reachLat + 3 * o.capFit) / o.step) + 1;
  const tr = sectionProfile(P, ctx.tris, s, 'y', A.u, x0, nx, o.step);
  const At = profileApex(tr, clampIdx(Math.round((uA - x0) / o.step), nx), o);
  if (At) {
    const iAt = clampIdx(Math.round((At.u - x0) / o.step), nx);
    const iMid = clampIdx(Math.round((0 - x0) / o.step), nx);
    const iLat = clampIdx(Math.round((At.u + o.reachLat - x0) / o.step), nx);
    let med = scanCross(tr, iAt, iMid, zWall);
    if (!med) {
      med = valleyFloor(tr, iMid, iAt, o);
      if (med) r.flags.push('medialAtValley');
    }
    let lat = scanCross(tr, iAt, iLat, zWall);
    if (!lat) {
      lat = endPoint(tr, iLat, iAt);
      if (lat) r.flags.push('lateralOpen');
    }
    if (med && lat) {
      r.medial = [med.u, med.z];
      r.lateral = [lat.u, lat.z];
      const iMed = clampIdx(Math.round((med.u - x0) / o.step), nx), iLt = clampIdx(Math.round((lat.u - x0) / o.step), nx);
      // A transverse cap barely deeper than its shallower border (a garment
      // bridging the cleavage: one arch from the midline to the side) has
      // neither a breast width nor a direction; a lateral border at the reach
      // limit would only track the reach. Report those as missing.
      const pt = At.z - Math.max(med.z, lat.z);
      if (pt < o.minTransverse * p) r.flags.push('transverseShallow');
      if (hasHole(tr, iMed, iLt, o.holeJump)) r.flags.push('transverseHole');
      const usable = pt >= o.minTransverse * p && !r.flags.includes('lateralOpen') && !r.flags.includes('transverseHole');
      if (usable) {
        r.baseWidth = lat.u - med.u;
        r.projectionRatio = r.baseWidth > 0 ? p / r.baseWidth : null;
        const tax = capAxis(tr, iAt, iLt, iMed, At, pt, o);
        if (tax) {
          r.taxis = tax;
          r.divergenceDeg = Math.atan(-tax.beta) * DEG;
        } else r.flags.push('noTransverseAxis');
      }
    }
  } else r.flags.push('noTransverseApex');

  r.ok = isNum(r.upperPoleFrac) && isNum(r.tiltDeg) && !r.flags.some((f) => NOT_OK.has(f));
  return r;
}

const clampIdx = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

// Flags that make a side's numbers meaningless: no mound, missing surface,
// apex not a local max, or a border that only exists because of the reach.
export const NOT_OK = new Set(['flat', 'hole', 'apexOnSearchEdge', 'imfOpen', 'topOpen']);

// Missing surface or a jump to another layer (e.g. skin cut out under a
// garment: the envelope falls through to the back of the torso).
function hasHole(pr, ia, ib, jump) {
  let prev = NaN;
  for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) {
    const z = pr.z[i];
    if (Number.isNaN(z)) return true;
    if (!Number.isNaN(prev) && Math.abs(z - prev) > jump) return true;
    prev = z;
  }
  return false;
}

// ------------------------------------------------------------------ sections

/**
 * Front envelope of a plane section. axis 'u': plane u = c (sagittal),
 * parameter y; axis 'y': plane y = c (transverse), parameter u. u is the
 * side coordinate s * x. Returns {u0, step, z: Float64Array (NaN = no
 * surface)} sampled at u0 + i * step.
 */
export function sectionProfile(P, tris, s, axis, c, u0, n, step) {
  const z = new Float64Array(n).fill(NaN);
  const cut = axis === 'u' ? 0 : 1; // coordinate defining the plane
  const prm = axis === 'u' ? 1 : 0; // in-plane parameter
  const coord = (v, k) => (k === 0 ? s * P[v * 3] : P[v * 3 + k]);
  const pts = [0, 0, 0, 0];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const vs = [tris[t], tris[t + 1], tris[t + 2]];
    const d0 = coord(vs[0], cut) - c, d1 = coord(vs[1], cut) - c, d2 = coord(vs[2], cut) - c;
    const neg0 = d0 < 0, neg1 = d1 < 0, neg2 = d2 < 0;
    if (neg0 === neg1 && neg1 === neg2) continue;
    const dd = [d0, d1, d2];
    let np = 0;
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3];
      const da = dd[k], db = dd[(k + 1) % 3];
      if (da < 0 === db < 0) continue;
      const f = da / (da - db);
      const pa = coord(a, prm), pb = coord(b, prm);
      const za = P[a * 3 + 2], zb = P[b * 3 + 2];
      pts[np * 2] = pa + f * (pb - pa);
      pts[np * 2 + 1] = za + f * (zb - za);
      np++;
    }
    if (np !== 2) continue;
    let ua = pts[0], za = pts[1], ub = pts[2], zb = pts[3];
    if (ub < ua) {
      ua = pts[2]; za = pts[3]; ub = pts[0]; zb = pts[1];
    }
    const i0 = Math.max(0, Math.ceil((ua - u0) / step - 1e-9)), i1 = Math.min(n - 1, Math.floor((ub - u0) / step + 1e-9));
    for (let i = i0; i <= i1; i++) {
      const u = u0 + i * step;
      const zz = ub > ua ? za + ((u - ua) / (ub - ua)) * (zb - za) : Math.max(za, zb);
      if (!(zz <= z[i])) z[i] = zz;
    }
  }
  return { u0, step, z, n };
}

// Front height map z(u, y) around (ue, ye) on side s, then a quadratic fit
// around its max cell. Returns {u, y, z, onEdge} or null.
export function heightMapApex(P, tris, s, ue, ye, o) {
  const c = o.cell, R = o.search;
  const n = Math.round((2 * R) / c);
  const gu0 = ue - R, gy0 = ye - R;
  const Z = new Float64Array(n * n).fill(NaN);
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], d = tris[t + 2];
    const ax = s * P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = s * P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const cx = s * P[d * 3], cy = P[d * 3 + 1], cz = P[d * 3 + 2];
    const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
    const y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
    if (x1 < gu0 || x0 > gu0 + n * c || y1 < gy0 || y0 > gy0 + n * c) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-18) continue;
    const i0 = Math.max(0, Math.ceil((x0 - gu0) / c - 0.5)), i1 = Math.min(n - 1, Math.floor((x1 - gu0) / c - 0.5));
    const j0 = Math.max(0, Math.ceil((y0 - gy0) / c - 0.5)), j1 = Math.min(n - 1, Math.floor((y1 - gy0) / c - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = gy0 + (j + 0.5) * c;
      for (let i = i0; i <= i1; i++) {
        const px = gu0 + (i + 0.5) * c;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const zz = l1 * az + l2 * bz + l3 * cz;
        const k = j * n + i;
        if (!(zz <= Z[k])) Z[k] = zz;
      }
    }
  }
  // max inside the search disk, on this side of the midline
  let best = -Infinity, bi = -1, bj = -1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const z = Z[j * n + i];
      if (!(z > best)) continue;
      const du = gu0 + (i + 0.5) * c - ue, dy = gy0 + (j + 0.5) * c - ye;
      if (du * du + dy * dy > R * R || gu0 + (i + 0.5) * c <= 0) continue;
      best = z;
      bi = i;
      bj = j;
    }
  if (bi < 0) return null;
  let cu = gu0 + (bi + 0.5) * c, cy = gy0 + (bj + 0.5) * c, cz = best;
  const du = cu - ue, dy = cy - ye;
  const onEdge = Math.sqrt(du * du + dy * dy) > R - 2 * c;
  // two passes of a local quadratic fit, re-centred on its stationary point
  const h = o.capFit;
  for (let pass = 0; pass < 2; pass++) {
    const rows = [], vals = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const z = Z[j * n + i];
        if (Number.isNaN(z)) continue;
        const a = (gu0 + (i + 0.5) * c - cu) / h, b = (gy0 + (j + 0.5) * c - cy) / h;
        if (a * a + b * b > 1) continue;
        rows.push([1, a, b, a * a, a * b, b * b]);
        vals.push(z);
      }
    if (rows.length < 12) break;
    const q = leastSquares(rows, vals);
    if (!q) break;
    const H00 = 2 * q[3], H01 = q[4], H11 = 2 * q[5];
    const dt = H00 * H11 - H01 * H01;
    if (!(H00 < 0 && dt > 0)) break;
    const sa = (-q[1] * H11 + q[2] * H01) / dt, sb = (-q[2] * H00 + q[1] * H01) / dt;
    if (sa * sa + sb * sb > 1) break;
    cu += sa * h;
    cy += sb * h;
    cz = q[0] + q[1] * sa + q[2] * sb + q[3] * sa * sa + q[4] * sa * sb + q[5] * sb * sb;
  }
  return { u: cu, y: cy, z: cz, onEdge };
}

// Max of a profile near sample i0 (within capFit), refined by a quadratic fit.
function profileApex(pr, i0, o) {
  const { z, u0, step, n } = pr;
  const w = Math.round(o.capFit / step);
  let bi = -1, best = -Infinity;
  for (let i = Math.max(0, i0 - 2 * w); i <= Math.min(n - 1, i0 + 2 * w); i++) {
    if (z[i] > best) {
      best = z[i];
      bi = i;
    }
  }
  if (bi < 0) return null;
  let cu = u0 + bi * step;
  const q = fitQuad1(pr, cu - o.capFit, cu + o.capFit);
  if (q && q.c2 < 0) {
    const t = -q.c1 / (2 * q.c2);
    if (Math.abs(t) <= 1) return { u: q.um + t * q.hw, z: q.c0 + q.c1 * t + q.c2 * t * t };
  }
  return { u: cu, z: best };
}

// Least-squares z = c0 + c1 t + c2 t^2, t = (u - um) / hw over [ua, ub].
export function fitQuad1(pr, ua, ub) {
  const { z, u0, step, n } = pr;
  const um = (ua + ub) / 2, hw = (ub - ua) / 2;
  if (!(hw > 0)) return null;
  const rows = [], vals = [];
  const i0 = Math.max(0, Math.ceil((ua - u0) / step - 1e-9)), i1 = Math.min(n - 1, Math.floor((ub - u0) / step + 1e-9));
  for (let i = i0; i <= i1; i++) {
    if (Number.isNaN(z[i])) continue;
    const t = (u0 + i * step - um) / hw;
    rows.push([1, t, t * t]);
    vals.push(z[i]);
  }
  if (rows.length < 5) return null;
  const q = leastSquares(rows, vals);
  return q ? { c0: q[0], c1: q[1], c2: q[2], um, hw } : null;
}

// IMF point from the knee K: keep its height (the fold you see on the
// surface) but take the depth from the chest-wall line fitted below it
// (over foldFit away from K), i.e. the bottom of the fold as if it were
// sharp. A coarse mesh cuts a rounded crease and lifts its bottom; the wall
// it joins is resolution independent. Null when there is no clear fold (the
// wall and the flank above differ by less than foldMinDeg).
function foldPoint(pr, K, A, o) {
  const [a, b] = o.foldFit;
  const lo = fitLine(pr, K.u - b, K.u - a, K.u), hi = fitLine(pr, K.u + a, Math.min(K.u + b, A.u), K.u);
  if (!lo || !hi) return null;
  const ang = Math.abs(Math.atan(hi.c1) - Math.atan(lo.c1)) * DEG;
  if (ang < o.foldMinDeg) return null;
  return { u: K.u, z: Math.min(lo.c0, K.z) };
}

// Least-squares line z = c0 + c1 (u - uRef) over the samples in [ua, ub].
function fitLine(pr, ua, ub, uRef) {
  const { z, u0, step, n } = pr;
  if (!(ub > ua)) return null;
  const rows = [], vals = [];
  const i0 = Math.max(0, Math.ceil((ua - u0) / step - 1e-9)), i1 = Math.min(n - 1, Math.floor((ub - u0) / step + 1e-9));
  for (let i = i0; i <= i1; i++) {
    if (Number.isNaN(z[i])) continue;
    rows.push([1, u0 + i * step - uRef]);
    vals.push(z[i]);
  }
  if (rows.length < 4) return null;
  const q = leastSquares(rows, vals);
  return q ? { c0: q[0], c1: q[1] } : null;
}

// Knee between the apex sample iA and the reference sample iRef: the point of
// the profile farthest behind the chord A -> ref (toward the body).
function knee(pr, iA, iRef, A, o) {
  const { z, u0, step } = pr;
  const ref = endPoint(pr, iRef, iA);
  if (!ref) return null;
  const tu = ref.u - A.u, tz = ref.z - A.z;
  const L = Math.sqrt(tu * tu + tz * tz);
  if (!(L > 0)) return null;
  // unit normal pointing behind the chord (negative z component)
  let nu = -tz / L, nz = tu / L;
  if (nz > 0) {
    nu = -nu;
    nz = -nz;
  }
  const dir = iRef > iA ? 1 : -1;
  const iEnd = Math.round((ref.u - u0) / step);
  const d = new Map();
  let best = 0, bi = -1;
  for (let i = iA + dir; dir > 0 ? i < iEnd : i > iEnd; i += dir) {
    if (Number.isNaN(z[i])) continue;
    const v = (u0 + i * step - A.u) * nu + (z[i] - A.z) * nz;
    d.set(i, v);
    if (v > best) {
      best = v;
      bi = i;
    }
  }
  if (bi < 0) return null;
  // centroid of the connected run within kneeFrac of the max (soft creases)
  const thr = o.kneeFrac * best, w = Math.round(o.kneeFit / step);
  let sw = 0, su = 0;
  for (const sgn of [1, -1]) {
    for (let k = sgn > 0 ? 0 : 1; k <= w; k++) {
      const i = bi + sgn * k;
      const v = d.get(i);
      if (v === undefined || v < thr) break;
      sw += v - thr;
      su += (v - thr) * (u0 + i * step);
    }
  }
  const u = sw > 0 ? su / sw : u0 + bi * step;
  return { u, z: interpAt(pr, u) };
}

// Last valid sample scanning from i toward iTo (inclusive).
function endPoint(pr, i, iTo) {
  const dir = iTo > i ? 1 : -1;
  for (let k = i; dir > 0 ? k <= iTo : k >= iTo; k += dir) if (!Number.isNaN(pr.z[k])) return { u: pr.u0 + k * pr.step, z: pr.z[k] };
  return null;
}

// First crossing of z <= zc scanning from iFrom toward iTo, interpolated.
export function scanCross(pr, iFrom, iTo, zc) {
  const { z, u0, step } = pr;
  const dir = iTo > iFrom ? 1 : -1;
  let prev = -1;
  for (let i = iFrom; dir > 0 ? i <= iTo : i >= iTo; i += dir) {
    if (Number.isNaN(z[i])) continue;
    if (z[i] <= zc) {
      if (prev < 0 || z[prev] === z[i]) return { u: u0 + i * step, z: z[i] };
      const t = (z[prev] - zc) / (z[prev] - z[i]);
      const ua = u0 + prev * step, ub = u0 + i * step;
      return { u: ua + t * (ub - ua), z: zc };
    }
    prev = i;
  }
  return null;
}

// Valley floor (min z) between samples ia and ib, refined by a quadratic fit
// over capFit so it does not jump from sample to sample.
function valleyFloor(pr, ia, ib, o) {
  let best = Infinity, bi = -1;
  const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
  for (let i = lo; i <= hi; i++) {
    if (pr.z[i] < best) {
      best = pr.z[i];
      bi = i;
    }
  }
  if (bi < 0) return null;
  const cu = pr.u0 + bi * pr.step;
  const q = fitQuad1(pr, cu - o.capFit, cu + o.capFit);
  if (q && q.c2 > 0) {
    const t = -q.c1 / (2 * q.c2);
    const u = q.um + t * q.hw;
    if (Math.abs(t) <= 1 && u >= pr.u0 + lo * pr.step && u <= pr.u0 + hi * pr.step) return { u, z: q.c0 + q.c1 * t + q.c2 * t * t };
  }
  return { u: cu, z: best };
}

function interpAt(pr, u) {
  const { z, u0, step, n } = pr;
  const f = (u - u0) / step;
  const i = Math.max(0, Math.min(n - 2, Math.floor(f)));
  const t = f - i;
  const a = z[i], b = z[i + 1];
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a + t * (b - a);
}

// Cap axis from the midpoints of constant-z chords at depths f * p behind A,
// bounded by the border samples iHi (above / lateral) and iLo (below / medial).
function capAxis(pr, iA, iHi, iLo, A, p, o) {
  if (!(p > 0)) return null;
  const ds = [], ms = [];
  for (const f of o.axisDepths) {
    const zc = A.z - f * p;
    const hi = scanCross(pr, iA, iHi, zc), lo = scanCross(pr, iA, iLo, zc);
    if (!hi || !lo || hi.z !== zc || lo.z !== zc) continue; // border reached first
    ds.push(f * p);
    ms.push((hi.u + lo.u) / 2);
  }
  if (ds.length < 2) return null;
  let sd = 0, sm = 0;
  for (let k = 0; k < ds.length; k++) {
    sd += ds[k];
    sm += ms[k];
  }
  const md = sd / ds.length, mm = sm / ds.length;
  let sdd = 0, sdm = 0;
  for (let k = 0; k < ds.length; k++) {
    sdd += (ds[k] - md) * (ds[k] - md);
    sdm += (ds[k] - md) * (ms[k] - mm);
  }
  if (!(sdd > 0)) return null;
  const beta = sdm / sdd;
  return { alpha: mm - beta * md, beta, ds, ms };
}

// Where the cap axis (u = alpha + beta * (z_A - z)) leaves the surface near A.
function axisExit(pr, ax, A, iA, o) {
  const { z, u0, step, n } = pr;
  const g = (i) => u0 + i * step - ax.alpha - ax.beta * (A.z - z[i]);
  const w = Math.round((2 * o.capFit) / step);
  // walk outward from the apex in both directions; take the nearest sign change
  for (let k = 0; k <= w; k++) {
    for (const sgn of [1, -1]) {
      const i = iA + sgn * k, j = i + sgn;
      if (i < 0 || j < 0 || i >= n || j >= n || Number.isNaN(z[i]) || Number.isNaN(z[j])) continue;
      const gi = g(i), gj = g(j);
      if (gi === 0) return { u: u0 + i * step, z: z[i] };
      if (gi < 0 !== gj < 0) {
        const t = gi / (gi - gj);
        return { u: u0 + (i + sgn * t) * step, z: z[i] + t * (z[j] - z[i]) };
      }
    }
  }
  return null;
}

// Signed sagitta ratio of the profile arc between crossing points P (lower
// y) and Q (higher y): least-squares quadratic z(y) over the arc, then the
// perpendicular deviation of the fitted parabola at mid-arc from its chord,
// over the chord length. > 0 when the arc bulges in front of the chord
// (convex). A fit rather than the area under the samples: the samples of a
// piecewise-linear mesh lie inside a convex surface by ~h^2 k / 12 on
// average, which biases areas by (2/3)(h/L)^2 of the sagitta but only shifts
// the fitted constant term.
export function arcSagitta(pr, P, Q) {
  const q = fitQuad1(pr, P.u, Q.u);
  if (!q) return null;
  const dy = 2 * q.hw, dz = 2 * q.c1;
  const L2 = dy * dy + dz * dz;
  return L2 > 0 ? (-q.c2 * dy) / L2 : null;
}

// Normal-equation least squares with partial-pivot Gaussian elimination (the
// systems are tiny; the Python mirror uses the same arithmetic for parity).
export function leastSquares(rows, vals) {
  const m = rows[0].length;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const x = rows[r];
    for (let i = 0; i < m; i++) {
      b[i] += x[i] * vals[r];
      for (let j = 0; j < m; j++) A[i][j] += x[i] * x[j];
    }
  }
  return solve(A, b);
}

export function solve(A, b) {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    if (p !== c) [M[p], M[c]] = [M[c], M[p]];
    for (let r = c + 1; r < m; r++) {
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= m; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let v = M[r][m];
    for (let k = r + 1; k < m; k++) v -= M[r][k] * x[k];
    x[r] = v / M[r][r];
  }
  return x;
}

// ------------------------------------------------------------------ tables

/** Flatten a result into {key: number|string} rows for tables (mean of sides). */
export function metricsRow(result) {
  const m = result.mean;
  const out = {};
  for (const { key, pct } of METRICS) out[key] = isNum(m[key]) ? (pct ? m[key] * 100 : m[key]) : null;
  out.upperShape = m.upperShape;
  out.lowerShape = m.lowerShape;
  return out;
}
