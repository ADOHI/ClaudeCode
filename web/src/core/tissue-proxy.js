// A small volumetric breast cage in normalized body coordinates (shoulder
// width = 1). The cage is a curvilinear Cartesian grid, with its front fitted
// to triangles of the *statically morphed* skin/fitted garment surface. This
// file only builds/rest-embeds geometry; dynamics belongs to TissueVolume.
//
// All render meshes use the same spatial interpolation. Split UV vertices and
// coincident garment/body vertices therefore receive identical displacement.
// A nearby front garment shell uses the front cage displacement without
// extrapolating it (which could amplify motion and invert the shell).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function bodyPoint(frame, x, y, z) {
  x -= frame.origin[0]; y -= frame.origin[1]; z -= frame.origin[2];
  const inv = 1 / frame.S;
  return [
    (x * frame.left[0] + y * frame.left[1] + z * frame.left[2]) * inv,
    (x * frame.up[0] + y * frame.up[1] + z * frame.up[2]) * inv,
    (x * frame.forward[0] + y * frame.forward[1] + z * frame.forward[2]) * inv,
  ];
}

function signedSixVolume(p, a, b, c, d) {
  const ax = p[3 * b] - p[3 * a], ay = p[3 * b + 1] - p[3 * a + 1], az = p[3 * b + 2] - p[3 * a + 2];
  const bx = p[3 * c] - p[3 * a], by = p[3 * c + 1] - p[3 * a + 1], bz = p[3 * c + 2] - p[3 * a + 2];
  const cx = p[3 * d] - p[3 * a], cy = p[3 * d + 1] - p[3 * a + 1], cz = p[3 * d + 2] - p[3 * a + 2];
  return ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
}

// Retain triangles rather than a point cloud: their projection is needed at
// every grid column even when the source mesh has sparse/uneven tessellation.
function surfaceData(frame, meshes, bounds, wall, maxFront) {
  const triangles = [], vertices = [];
  for (const mesh of meshes) {
    const pos = mesh.pos ?? mesh.positions;
    if (!pos) continue;
    const count = pos.length / 3, body = new Float64Array(pos.length);
    for (let v = 0; v < count; v++) {
      const b = bodyPoint(frame, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      body.set(b, v * 3);
      if ((!mesh.mask || mesh.mask[v] > 0.1) && b[0] >= bounds.x0 && b[0] <= bounds.x1 && b[1] >= bounds.y0 && b[1] <= bounds.y1 && b[2] >= wall && b[2] <= maxFront) vertices.push(b);
    }
    const index = mesh.index ?? mesh.tris;
    const n = index ? index.length : count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = index ? index[t] : t, b = index ? index[t + 1] : t + 1, c = index ? index[t + 2] : t + 2;
      if (mesh.mask && (mesh.mask[a] <= 0.1 || mesh.mask[b] <= 0.1 || mesh.mask[c] <= 0.1)) continue;
      const ax = body[3 * a], ay = body[3 * a + 1], az = body[3 * a + 2];
      const bx = body[3 * b], by = body[3 * b + 1], bz = body[3 * b + 2];
      const cx = body[3 * c], cy = body[3 * c + 1], cz = body[3 * c + 2];
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
      if (x1 < bounds.x0 || x0 > bounds.x1 || y1 < bounds.y0 || y0 > bounds.y1 || Math.max(az, bz, cz) < wall || Math.min(az, bz, cz) > maxFront) continue;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-14) continue;
      triangles.push({ ax, ay, az, bx, by, bz, cx, cy, cz, x0, x1, y0, y1, invDet: 1 / det });
    }
  }
  return { triangles, vertices };
}

function frontAt(surface, x, y, wall, maxFront, maxNearest) {
  let front = -Infinity;
  for (const t of surface.triangles) {
    if (x < t.x0 - 1e-10 || x > t.x1 + 1e-10 || y < t.y0 - 1e-10 || y > t.y1 + 1e-10) continue;
    const a = ((t.by - t.cy) * (x - t.cx) + (t.cx - t.bx) * (y - t.cy)) * t.invDet;
    const b = ((t.cy - t.ay) * (x - t.cx) + (t.ax - t.cx) * (y - t.cy)) * t.invDet;
    const c = 1 - a - b;
    if (a < -1e-9 || b < -1e-9 || c < -1e-9) continue;
    const z = a * t.az + b * t.bz + c * t.cz;
    if (z >= wall && z <= maxFront && z > front) front = z;
  }
  if (Number.isFinite(front)) return { z: front, kind: 'triangle', gap: 0 };
  let nearest = Infinity, z = NaN;
  for (const p of surface.vertices) {
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < nearest) { nearest = d; z = p[2]; }
  }
  return { z: nearest <= maxNearest ? z : NaN, kind: nearest <= maxNearest ? 'vertex' : 'fallback', gap: nearest };
}

function cell(side, x, y) {
  const gx = clamp((x - side.xMin) / (side.xMax - side.xMin) * (side.nx - 1), 0, side.nx - 1);
  const gy = clamp((y - side.yMin) / (side.yMax - side.yMin) * (side.ny - 1), 0, side.ny - 1);
  const ix = Math.min(Math.floor(gx), side.nx - 2), iy = Math.min(Math.floor(gy), side.ny - 2);
  const u = gx - ix, v = gy - iy;
  const column = iy * side.nx + ix;
  const h = side.front;
  const front = (1 - v) * ((1 - u) * h[column] + u * h[column + 1]) + v * ((1 - u) * h[column + side.nx] + u * h[column + side.nx + 1]);
  return { ix, iy, u, v, front };
}

/**
 * @param {object} args
 * @param {object} args.frame buildBodyFrame result; positions are in bind space.
 * @param {object} args.params fitted DEFAULT_PARAMS-compatible anatomy.
 * @param {Array<{pos:ArrayLike<number>,index?:ArrayLike<number>,mask?:ArrayLike<number>}>} args.meshes selected skin/fitted torso geometry, after static morphing.
 * @param {number[]} [args.divisions] cells in x/y/depth, default [4,5,3].
 * @returns {{positions:Float64Array,tets:Uint32Array,fixed:Uint8Array,sides:Array,info:object,embed:Function,displacement:Function}}
 */
export function buildTissueProxy({ frame, params, meshes = [], divisions = [4, 5, 3], shell = 0.06 }) {
  if (!(frame?.S > 0) || !Number.isFinite(frame.S)) throw new Error('Tissue proxy requires a finite, positive body scale');
  if (!params?.anchor || !(params.depth > 0)) throw new Error('Tissue proxy requires an anchor and positive depth');
  if (divisions.length !== 3 || divisions.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('Tissue proxy divisions must contain three positive integers');
  const [dx, dy, dz] = divisions, nx = dx + 1, ny = dy + 1, nz = dz + 1;
  const depth = params.depth, wall = params.anchor.z;
  const rx = Math.max(0.035, Math.min(params.window?.x ?? 0.32, Math.max(0.035, Math.abs(params.anchor.x) * 0.99)));
  const ryUp = Math.max(0.04, (params.window?.yUp ?? 0.44) * 0.72);
  const ryDown = Math.max(0.04, (params.window?.yDown ?? 0.42) * 0.72);
  const yMin = params.anchor.y - ryDown, yMax = params.anchor.y + ryUp;
  const maxFront = wall + Math.max(depth * 3, 0.08), minDepth = Math.max(depth * 0.025, 1e-4);
  const bounds = { x0: -Math.abs(params.anchor.x) - rx, x1: Math.abs(params.anchor.x) + rx, y0: yMin, y1: yMax };
  const surface = surfaceData(frame, meshes, bounds, wall, maxFront);
  const nodeCount = nx * ny * nz * 2;
  const positions = new Float64Array(nodeCount * 3), fixed = new Uint8Array(nodeCount), tetList = [], sides = [];
  const info = { nodeCount, tetCount: dx * dy * dz * 12, sampledColumns: 0, nearestColumns: 0, fallbackColumns: 0, sourceTriangles: surface.triangles.length, sourceVertices: surface.vertices.length, maxNearestGap: 0, shell };
  const localTets = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
  for (const sign of [1, -1]) {
    const cx = sign * Math.abs(params.anchor.x);
    const side = { sign, offset: sides.length * nx * ny * nz, nx, ny, nz, xMin: cx - rx, xMax: cx + rx, yMin, yMax, cx, cy: params.anchor.y, rx, ryUp, ryDown, wall, front: new Float64Array(nx * ny) };
    const nearestRadius = Math.hypot(2 * rx / dx, (yMax - yMin) / dy) * 0.7;
    const id = (x, y, z) => side.offset + (z * ny + y) * nx + x;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const x = side.xMin + ix / dx * 2 * rx, y = yMin + iy / dy * (yMax - yMin);
      const r = Math.hypot((x - cx) / rx, (y - side.cy) / (y >= side.cy ? ryUp : ryDown));
      const fit = frontAt(surface, x, y, wall, maxFront, nearestRadius);
      const h = Number.isFinite(fit.z) ? fit.z - wall : depth * Math.sqrt(Math.max(0, 1 - r * r));
      const front = wall + Math.max(minDepth, h);
      side.front[iy * nx + ix] = front;
      if (fit.kind === 'triangle') info.sampledColumns++;
      else if (fit.kind === 'vertex') info.nearestColumns++;
      else info.fallbackColumns++;
      if (Number.isFinite(fit.gap)) info.maxNearestGap = Math.max(info.maxNearestGap, fit.gap);
      for (let iz = 0; iz < nz; iz++) {
        const k = id(ix, iy, iz);
        positions.set([x, y, wall + iz / dz * (front - wall)], 3 * k);
        // All depth samples at the ellipse's outer rim are attached to the
        // torso; the entire posterior face is attached to the chest wall.
        fixed[k] = iz === 0 || ix === 0 || ix === dx || iy === 0 || iy === dy || r >= 1 ? 1 : 0;
      }
    }
    for (let iz = 0; iz < dz; iz++) for (let iy = 0; iy < dy; iy++) for (let ix = 0; ix < dx; ix++) {
      const c = [id(ix, iy, iz), id(ix + 1, iy, iz), id(ix, iy + 1, iz), id(ix + 1, iy + 1, iz), id(ix, iy, iz + 1), id(ix + 1, iy, iz + 1), id(ix, iy + 1, iz + 1), id(ix + 1, iy + 1, iz + 1)];
      for (const t of localTets) {
        const [a, b, c3, d] = t.map((v) => c[v]);
        if (signedSixVolume(positions, a, b, c3, d) > 0) tetList.push(a, b, c3, d);
        else tetList.push(a, c3, b, d);
      }
    }
    sides.push(side);
  }
  const tets = new Uint32Array(tetList);

  // An embedding stores compact interpolation data only. 'mask' is a C2
  // spatial attachment window times the caller's anatomical/exclusion mask.
  // It deliberately uses no nearest-vertex or per-mesh decision at playback.
  function embed(pointsBind, masks = null) {
    if (pointsBind.length % 3) throw new Error('Tissue embedding positions must be packed xyz triples');
    const count = pointsBind.length / 3;
    if (masks && masks.length !== count) throw new Error('Tissue embedding mask count must match position count');
    const indices = new Int32Array(count * 8).fill(-1), weights = new Float64Array(count * 8), mask = new Float64Array(count), gaps = new Float64Array(count).fill(Infinity), active = [];
    for (let p = 0; p < count; p++) {
      const userMask = masks ? clamp(masks[p], 0, 1) : 1;
      if (!(userMask > 0)) continue;
      const [x, y, z] = bodyPoint(frame, pointsBind[3 * p], pointsBind[3 * p + 1], pointsBind[3 * p + 2]);
      const side = sides[x >= 0 ? 0 : 1];
      const r = Math.hypot((x - side.cx) / side.rx, (y - side.cy) / (y >= side.cy ? side.ryUp : side.ryDown));
      if (r >= 1 || z <= wall) continue;
      const c = cell(side, x, y), gap = Math.max(0, z - c.front);
      gaps[p] = gap;
      // Full coupling through the first half of the nearby shell, then a
      // smooth fade to zero at 0.06 shoulder widths. Remote hair/loose layers
      // must still be excluded by the caller's material/bone mask.
      const shellWeight = shell > 0 ? 1 - smooth((gap - shell * 0.5) / (shell * 0.5)) : +(gap <= 0);
      const zeta = clamp((z - wall) / (c.front - wall), 0, 1);
      const w = userMask * (1 - smooth((r - 0.45) / 0.55)) * smooth(zeta / 0.24) * shellWeight;
      if (!(w > 0)) continue;
      const gz = zeta * dz, iz = Math.min(Math.floor(gz), dz - 1), q = gz - iz;
      let j = p * 8;
      for (let oz = 0; oz < 2; oz++) for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
        indices[j] = side.offset + (((iz + oz) * ny + c.iy + oy) * nx + c.ix + ox);
        weights[j] = (ox ? c.u : 1 - c.u) * (oy ? c.v : 1 - c.v) * (oz ? q : 1 - q);
        j++;
      }
      mask[p] = w;
      active.push(p);
    }
    return { indices, weights, mask, gaps, count, active: new Uint32Array(active) };
  }

  // livePositions are absolute, normalized body-space cage positions. Output
  // is a normalized body-space *vector*, never a transformed position. Reuse
  // out to avoid allocation in the render loop, then map axes * frame.S.
  function displacement(embedding, livePositions, out = new Float64Array(embedding.count * 3)) {
    if (livePositions.length !== positions.length) throw new Error('Live tissue position count does not match proxy');
    if (out.length !== embedding.count * 3) throw new Error('Tissue displacement output count does not match embedding');
    out.fill(0);
    const { indices, weights, mask, active } = embedding;
    for (const p of active) {
      let x = 0, y = 0, z = 0;
      for (let j = p * 8; j < p * 8 + 8; j++) {
        const k = indices[j] * 3, w = weights[j];
        x += w * (livePositions[k] - positions[k]);
        y += w * (livePositions[k + 1] - positions[k + 1]);
        z += w * (livePositions[k + 2] - positions[k + 2]);
      }
      out[3 * p] = x * mask[p]; out[3 * p + 1] = y * mask[p]; out[3 * p + 2] = z * mask[p];
    }
    return out;
  }
  return { positions, tets, fixed, sides, info, embed, displacement };
}
