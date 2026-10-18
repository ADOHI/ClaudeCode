// Distributed tetrahedral XPBD strain + volume proxy, in body/S coordinates.
//
// The six rotation-invariant Green strain constraints integrate
//   U_s = mu * V0 * tr(E^2), E = (F^T F - I)/2.
// Finite local J penalties resist compression; one volume constraint per
// connected zone preserves the overall volume without hard-locking every tet.
// This is a rest-preserving, StVK-like research proxy, NOT a calibrated
// Neo-Hookean material or a medical tissue/FEM ground truth. The safety line
// search bounds inversion, edge stretch, and travel; report() exposes its use.
// XPBD compliance is alpha / h^2 (Macklin et al., 2016); each material energy
// is weighted by rest volume, so refining a cage does not add arbitrary springs.

const EPS = 1e-14;
const EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const STRAIN = [[0, 0], [1, 1], [2, 2], [0, 1], [0, 2], [1, 2]];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;
const component = (a, i) => finite(a?.[i], 0);

function det3(a, b, c, d, e, f, g, h, i) {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Body coordinates and forces use S-normalized length and seconds.
 * `gravity` is a DELTA from gravity in the authored rest pose, not full gravity.
 * `fixed[i]` is 1 for chest wall / attachment nodes and 0 for free tissue.
 * Constructor material values may be flat or in `material`.
 */
export class TissueVolume {
  constructor({ positions, tets, fixed, material = {}, ...options } = {}) {
    if (!positions || positions.length < 12 || positions.length % 3) {
      throw new Error('TissueVolume positions must contain at least four xyz nodes');
    }
    if (!tets || !tets.length || tets.length % 4) {
      throw new Error('TissueVolume tets must contain tetrahedron vertex indices');
    }
    this.restPositions = Float64Array.from(positions);
    if (!this.restPositions.every(Number.isFinite)) throw new Error('TissueVolume positions must be finite');
    this.positions = this.restPositions.slice();
    this.displacements = new Float64Array(positions.length);
    this.velocities = new Float64Array(positions.length);
    this.nodeCount = positions.length / 3;
    this.tets = Uint32Array.from(tets);
    if (!Array.from(tets).every(i => Number.isInteger(i) && i >= 0 && i < this.nodeCount)) {
      throw new Error('TissueVolume tetrahedron index out of bounds');
    }
    if (fixed && fixed.length !== this.nodeCount) throw new Error('TissueVolume fixed length must match nodes');
    this.fixed = Uint8Array.from(fixed ?? new Uint8Array(this.nodeCount), x => x ? 1 : 0);
    this.tetCount = tets.length / 4;
    this._restVolume = new Float64Array(this.tetCount);
    this._restSigned = new Float64Array(this.tetCount);
    this._shapeGradients = new Float64Array(this.tetCount * 12);
    this._restEdges = new Float64Array(this.tetCount * 6);
    this.masses = new Float64Array(this.nodeCount);
    this.inverseMasses = new Float64Array(this.nodeCount);
    this._lambda = new Float64Array(this.tetCount * 7);
    this._g = new Float64Array(12);
    this._F = new Float64Array(9);
    this._previous = new Float64Array(positions.length);
    this._candidate = new Float64Array(positions.length);
    this._zoneGradient = new Float64Array(positions.length);
    this._config = { ...material, ...options };
    this._stats = { substeps: 0, safetyClamps: 0, resets: 0, droppedTime: 0, simulatedTime: 0 };

    const parent = Array.from({ length: this.nodeCount }, (_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    let totalVolume = 0;
    for (let t = 0; t < this.tetCount; t++) {
      const ids = this.tets.subarray(t * 4, t * 4 + 4);
      if (new Set(ids).size !== 4) throw new Error('TissueVolume tetrahedron must have four distinct nodes');
      const a = ids[0] * 3, b = ids[1] * 3, c = ids[2] * 3, d = ids[3] * 3;
      const p = this.restPositions;
      const x1 = p[b] - p[a], x2 = p[c] - p[a], x3 = p[d] - p[a];
      const y1 = p[b + 1] - p[a + 1], y2 = p[c + 1] - p[a + 1], y3 = p[d + 1] - p[a + 1];
      const z1 = p[b + 2] - p[a + 2], z2 = p[c + 2] - p[a + 2], z3 = p[d + 2] - p[a + 2];
      const determinant = det3(x1, x2, x3, y1, y2, y3, z1, z2, z3);
      if (Math.abs(determinant) < EPS) throw new Error('TissueVolume tetrahedron is degenerate');
      const signed = determinant / 6, volume = Math.abs(signed), gi = t * 12;
      this._restSigned[t] = signed;
      this._restVolume[t] = volume;
      totalVolume += volume;
      // Rows of Dm^-1 are the gradients of the three non-origin shape functions.
      const inv = 1 / determinant;
      const g = this._shapeGradients;
      g[gi + 3] = (y2 * z3 - y3 * z2) * inv;
      g[gi + 4] = (x3 * z2 - x2 * z3) * inv;
      g[gi + 5] = (x2 * y3 - x3 * y2) * inv;
      g[gi + 6] = (y3 * z1 - y1 * z3) * inv;
      g[gi + 7] = (x1 * z3 - x3 * z1) * inv;
      g[gi + 8] = (x3 * y1 - x1 * y3) * inv;
      g[gi + 9] = (y1 * z2 - y2 * z1) * inv;
      g[gi + 10] = (x2 * z1 - x1 * z2) * inv;
      g[gi + 11] = (x1 * y2 - x2 * y1) * inv;
      for (let k = 0; k < 3; k++) g[gi + k] = -g[gi + 3 + k] - g[gi + 6 + k] - g[gi + 9 + k];
      for (const id of ids) {
        this.masses[id] += volume / 4;
        parent[find(id)] = find(ids[0]);
      }
      for (let e = 0; e < 6; e++) {
        const i = ids[EDGES[e][0]] * 3, j = ids[EDGES[e][1]] * 3;
        this._restEdges[t * 6 + e] = Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1], p[i + 2] - p[j + 2]);
      }
    }
    this.restVolume = totalVolume;
    this.characteristicLength = Math.cbrt(totalVolume);
    const zones = new Map();
    for (let t = 0; t < this.tetCount; t++) {
      const key = find(this.tets[t * 4]);
      if (!zones.has(key)) zones.set(key, { tets: [], nodes: [], volume: 0, lambda: 0 });
      const zone = zones.get(key);
      zone.tets.push(t);
      zone.volume += this._restVolume[t];
    }
    for (let i = 0; i < this.nodeCount; i++) {
      if (!this.masses[i]) throw new Error('TissueVolume has an unused node');
      zones.get(find(i)).nodes.push(i);
    }
    this._zones = Array.from(zones.values());
    this._activeTets = Array.from({ length:this.tetCount }, (_,t)=>t).filter(t => {
      for(let k=0;k<4;k++) if(!this.fixed[this.tets[t*4+k]]) return true;
      return false;
    });
    const active = new Set(this._activeTets);
    for(const zone of this._zones) {
      zone.activeTets = zone.tets.filter(t=>active.has(t));
      zone.fixedVolume = zone.tets.filter(t=>!active.has(t)).reduce((sum,t)=>sum+this._restVolume[t],0);
    }
    this._resolveMaterial();
  }

  _resolveMaterial(options = {}) {
    Object.assign(this._config, options.material ?? {}, options);
    const c = this._config;
    const softness = clamp(finite(c.softness, 0.65), 0, 1);
    this.material = {
      softness,
      shearModulus: Math.max(0.01, finite(c.shearModulus, 2.5 * 12 ** (1 - softness))),
      damping: clamp(finite(c.damping, 2.5), 0, 60),
      exaggeration: clamp(finite(c.exaggeration, 1), 0, 5),
      density: Math.max(0.01, finite(c.density, 1)),
      minDet: clamp(finite(c.minDet, 0.22), 0.02, 0.95),
      maxStrain: clamp(finite(c.maxStrain, 0.7), 0.05, 2),
      maxDisplacement: Math.max(1e-5, finite(c.maxDisplacement, this.characteristicLength * 0.9)),
      maxAcceleration: Math.max(0.1, finite(c.maxAcceleration, 80)),
      maxSubstep: clamp(finite(c.maxSubstep, 1 / 120), 1 / 1000, 1 / 120),
      maxFrameTime: clamp(finite(c.maxFrameTime, 0.25), 1 / 60, 0.5),
      iterations: clamp(Math.round(finite(c.iterations, 7)), 1, 24),
    };
    this.material.bulkModulus = Math.max(0.01, finite(c.bulkModulus, this.material.shearModulus * 12));
    this.material.zonalBulkModulus = Math.max(0.01, finite(c.zonalBulkModulus, this.material.shearModulus * 90));
    for (let i = 0; i < this.nodeCount; i++) this.inverseMasses[i] = this.fixed[i] ? 0 : 1 / (this.masses[i] * this.material.density);
  }

  reset() {
    this.positions.set(this.restPositions);
    this.velocities.fill(0);
    this.displacements.fill(0);
    this._lambda.fill(0);
    for (const zone of this._zones) zone.lambda = 0;
    return this;
  }

  impulse(linear = [0, 0, 0], angular = [0, 0, 0], gain = this.material.exaggeration) {
    const s = clamp(finite(gain, 1), 0, 5), p = this.positions, v = this.velocities;
    for (let n = 0; n < this.nodeCount; n++) {
      if (this.fixed[n]) continue;
      const i = n * 3;
      const x = component(angular, 1) * p[i + 2] - component(angular, 2) * p[i + 1];
      const y = component(angular, 2) * p[i] - component(angular, 0) * p[i + 2];
      const z = component(angular, 0) * p[i + 1] - component(angular, 1) * p[i];
      v[i] -= s * (component(linear, 0) + x);
      v[i + 1] -= s * (component(linear, 1) + y);
      v[i + 2] -= s * (component(linear, 2) + z);
    }
  }

  // ChestTracker supplies start/middle/end kinematics. Sample that continuous
  // interval at each physical substep, rather than holding a render-frame
  // midpoint acceleration through every substep at low display frame rates.
  advanceTracked(step, options = {}) {
    this._resolveMaterial(options);
    if (!Number.isFinite(step.h) || step.h <= 0) return this.positions;
    if (step.h > this.material.maxFrameTime) return this.update(step.h);
    this.impulse(step.dv, step.dw, this.material.exaggeration);
    const count = Math.max(1, Math.ceil(step.h / this.material.maxSubstep - 1e-10));
    const h = step.h / count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const w = [2 * (t - 0.5) * (t - 1), 4 * t * (1 - t), 2 * t * (t - 0.5)];
      const sample = triplet => [0, 1, 2].map(k => w.reduce((sum, x, j) => sum + x * component(triplet?.[j], k), 0));
      this.update(h, { acceleration: sample(step.a), angularVelocity: sample(step.w), angularAcceleration: sample(step.alpha), gravity: sample(step.g) });
    }
    return this.positions;
  }

  // Writes F column-major. Shape gradients are constant in the material frame.
  _deformation(t) {
    const F = this._F, p = this.positions, g = this._shapeGradients, base = t * 12;
    F.fill(0);
    for (let v = 0; v < 4; v++) {
      const i = this.tets[t * 4 + v] * 3, k = base + v * 3;
      for (let col = 0; col < 3; col++) {
        const q = col * 3, w = g[k + col];
        F[q] += p[i] * w; F[q + 1] += p[i + 1] * w; F[q + 2] += p[i + 2] * w;
      }
    }
    return F;
  }

  _project(t, constraint, compliance, h, lambdaIndex) {
    const g = this._g;
    let denom = compliance / (h * h);
    for (let v = 0; v < 4; v++) {
      const k = v * 3, w = this.inverseMasses[this.tets[t * 4 + v]];
      denom += w * (g[k] ** 2 + g[k + 1] ** 2 + g[k + 2] ** 2);
    }
    if (!(denom > EPS)) return;
    const alpha = compliance / (h * h);
    const dl = (-constraint - alpha * this._lambda[lambdaIndex]) / denom;
    this._lambda[lambdaIndex] += dl;
    for (let v = 0; v < 4; v++) {
      const node = this.tets[t * 4 + v], i = node * 3, k = v * 3;
      const w = this.inverseMasses[node] * dl;
      this.positions[i] += w * g[k]; this.positions[i + 1] += w * g[k + 1]; this.positions[i + 2] += w * g[k + 2];
    }
  }

  _strain(t, c, h) {
    const [a, b] = STRAIN[c], F = this._deformation(t), ga = this._shapeGradients, base = t * 12;
    const i = a * 3, j = b * 3;
    const product = F[i] * F[j] + F[i + 1] * F[j + 1] + F[i + 2] * F[j + 2];
    const diagonal = a === b;
    const C = diagonal ? (product - 1) / 2 : product;
    if (Math.abs(C) < 1e-14 && this._lambda[t * 7 + c] === 0) return;
    for (let v = 0; v < 4; v++) {
      const q = v * 3, k = base + q, ai = ga[k + a], bi = ga[k + b];
      for (let dim = 0; dim < 3; dim++) this._g[q + dim] = diagonal ? ai * F[i + dim] : ai * F[j + dim] + bi * F[i + dim];
    }
    // With Cij = 2Eij: diag alpha=1/(2muV), shear alpha=1/(muV).
    const compliance = 1 / ((diagonal ? 2 : 1) * this.material.shearModulus * this._restVolume[t]);
    this._project(t, C, compliance, h, t * 7 + c);
  }

  // Writes grad(J) for one tet; works for either authored orientation.
  _volumeGradient(t) {
    const p = this.positions, ids = this.tets, q = t * 4;
    const i = ids[q] * 3, j = ids[q + 1] * 3, k = ids[q + 2] * 3, l = ids[q + 3] * 3;
    const ax = p[j] - p[i], ay = p[j + 1] - p[i + 1], az = p[j + 2] - p[i + 2];
    const bx = p[k] - p[i], by = p[k + 1] - p[i + 1], bz = p[k + 2] - p[i + 2];
    const cx = p[l] - p[i], cy = p[l + 1] - p[i + 1], cz = p[l + 2] - p[i + 2];
    const scale = 1 / (6 * this._restSigned[t]), g = this._g;
    g[3] = (by * cz - bz * cy) * scale; g[4] = (bz * cx - bx * cz) * scale; g[5] = (bx * cy - by * cx) * scale;
    g[6] = (cy * az - cz * ay) * scale; g[7] = (cz * ax - cx * az) * scale; g[8] = (cx * ay - cy * ax) * scale;
    g[9] = (ay * bz - az * by) * scale; g[10] = (az * bx - ax * bz) * scale; g[11] = (ax * by - ay * bx) * scale;
    for (let d = 0; d < 3; d++) g[d] = -g[3 + d] - g[6 + d] - g[9 + d];
    return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) * scale;
  }

  _zonalVolume(zone, h) {
    const gradients = this._zoneGradient;
    for (const node of zone.nodes) gradients.fill(0, node * 3, node * 3 + 3);
    let volume = zone.fixedVolume / zone.volume;
    for (const t of zone.activeTets) {
      const J = this._volumeGradient(t), factor = this._restVolume[t] / zone.volume;
      volume += J * factor;
      for (let v = 0; v < 4; v++) {
        const i = this.tets[t * 4 + v] * 3, k = v * 3;
        gradients[i] += this._g[k] * factor; gradients[i + 1] += this._g[k + 1] * factor; gradients[i + 2] += this._g[k + 2] * factor;
      }
    }
    const alpha = 1 / (this.material.zonalBulkModulus * zone.volume * h * h);
    let denom = alpha;
    for (const node of zone.nodes) {
      const i = node * 3;
      denom += this.inverseMasses[node] * (gradients[i] ** 2 + gradients[i + 1] ** 2 + gradients[i + 2] ** 2);
    }
    const dl = (1 - volume - alpha * zone.lambda) / denom;
    zone.lambda += dl;
    for (const node of zone.nodes) {
      const i = node * 3, w = this.inverseMasses[node] * dl;
      this.positions[i] += w * gradients[i]; this.positions[i + 1] += w * gradients[i + 1]; this.positions[i + 2] += w * gradients[i + 2];
    }
  }

  _measure(includeEdges = true) {
    let volume = 0, minDet = Infinity, maxStrain = 0, maxDisplacement = 0, touchedNodes = 0;
    const p = this.positions, rest = this.restPositions;
    for (let t = 0; t < this.tetCount; t++) {
      const J = this._volumeGradient(t);
      if (!Number.isFinite(J)) return { minDet: -Infinity, maxStrain: Infinity, maxDisplacement: Infinity };
      minDet = Math.min(minDet, J);
      volume += J * this._restVolume[t];
      if (includeEdges) for (let e = 0; e < 6; e++) {
        const a = this.tets[t * 4 + EDGES[e][0]] * 3, b = this.tets[t * 4 + EDGES[e][1]] * 3;
        const length = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
        maxStrain = Math.max(maxStrain, Math.abs(length / this._restEdges[t * 6 + e] - 1));
      }
    }
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i] - rest[i], p[i + 1] - rest[i + 1], p[i + 2] - rest[i + 2]);
      if (!Number.isFinite(d)) return { minDet: -Infinity, maxStrain: Infinity, maxDisplacement: Infinity };
      maxDisplacement = Math.max(maxDisplacement, d);
      if (d > 1e-8) touchedNodes++;
    }
    return { volume, restVolume: this.restVolume, volumeError: volume / this.restVolume - 1, minDet, maxStrain, maxDisplacement, touchedNodes };
  }

  _safe() {
    const s = this._measure(), m = this.material;
    return s.minDet >= m.minDet && s.maxStrain <= m.maxStrain && s.maxDisplacement <= m.maxDisplacement;
  }

  _substep(h, force) {
    const p = this.positions, v = this.velocities, prev = this._previous, m = this.material;
    prev.set(p);
    const decay = Math.exp(-m.damping * h);
    const wx = component(force.angularVelocity, 0), wy = component(force.angularVelocity, 1), wz = component(force.angularVelocity, 2);
    const ex = component(force.angularAcceleration, 0), ey = component(force.angularAcceleration, 1), ez = component(force.angularAcceleration, 2);
    const ax = component(force.gravity, 0) - component(force.acceleration, 0);
    const ay = component(force.gravity, 1) - component(force.acceleration, 1);
    const az = component(force.gravity, 2) - component(force.acceleration, 2);
    const ox = component(force.rotationOrigin, 0), oy = component(force.rotationOrigin, 1), oz = component(force.rotationOrigin, 2);
    for (let node = 0; node < this.nodeCount; node++) {
      const i = node * 3;
      if (this.fixed[node]) { p.set(this.restPositions.subarray(i, i + 3), i); v.fill(0, i, i + 3); continue; }
      const rx = p[i] - ox, ry = p[i + 1] - oy, rz = p[i + 2] - oz;
      const cx = wy * rz - wz * ry, cy = wz * rx - wx * rz, cz = wx * ry - wy * rx;
      let fx = ax - (ey * rz - ez * ry) - (wy * cz - wz * cy) - 2 * (wy * v[i + 2] - wz * v[i + 1]);
      let fy = ay - (ez * rx - ex * rz) - (wz * cx - wx * cz) - 2 * (wz * v[i] - wx * v[i + 2]);
      let fz = az - (ex * ry - ey * rx) - (wx * cy - wy * cx) - 2 * (wx * v[i + 1] - wy * v[i]);
      const magnitude = Math.hypot(fx, fy, fz) * m.exaggeration;
      const scale = m.exaggeration * Math.min(1, m.maxAcceleration / Math.max(magnitude, EPS));
      fx *= scale; fy *= scale; fz *= scale;
      v[i] = v[i] * decay + fx * h; v[i + 1] = v[i + 1] * decay + fy * h; v[i + 2] = v[i + 2] * decay + fz * h;
      p[i] += v[i] * h; p[i + 1] += v[i + 1] * h; p[i + 2] += v[i + 2] * h;
    }
    this._lambda.fill(0);
    for (const zone of this._zones) zone.lambda = 0;
    for (let iteration = 0; iteration < m.iterations; iteration++) {
      // Reverse traversal every iteration reduces Gauss-Seidel directional bias.
      const reverse = iteration % 2;
      for (let k = 0; k < this._activeTets.length; k++) {
        const t = this._activeTets[reverse ? this._activeTets.length - 1 - k : k];
        for (let c = 0; c < 6; c++) this._strain(t, c, h);
        const J = this._volumeGradient(t);
        this._project(t, J - 1, 1 / (m.bulkModulus * this._restVolume[t]), h, t * 7 + 6);
      }
      for (const zone of this._zones) this._zonalVolume(zone, h);
    }
    if (!this._safe()) {
      this._stats.safetyClamps++;
      this._candidate.set(p);
      let accepted = false;
      for (let fraction = 0.5; fraction >= 1 / 1024; fraction *= 0.5) {
        for (let i = 0; i < p.length; i++) p[i] = prev[i] + fraction * (this._candidate[i] - prev[i]);
        if (this._safe()) { accepted = true; break; }
      }
      if (!accepted) p.set(prev);
    }
    for (let i = 0; i < p.length; i++) v[i] = (p[i] - prev[i]) / h;
    this._stats.substeps++;
    this._stats.simulatedTime += h;
  }

  /** Advance actual elapsed dt. A pause/cut beyond maxFrameTime resets safely. */
  update(dt, force = {}, options = {}) {
    if (Object.keys(options).length) this._resolveMaterial(options);
    if (!Number.isFinite(dt) || dt <= 0) return this.positions;
    if (force.cut || dt > this.material.maxFrameTime) {
      this.reset(); this._stats.resets++; this._stats.droppedTime += dt;
      return this.positions;
    }
    const noLoad = ['acceleration','angularVelocity','angularAcceleration','gravity'].every(key => [0,1,2].every(i=>Math.abs(component(force[key],i))<1e-12));
    if(noLoad && this.velocities.every(v=>Math.abs(v)<1e-6) && this.positions.every((p,i)=>Math.abs(p-this.restPositions[i])<1e-7)) {
      this.reset();
      this._stats.simulatedTime += dt;
      return this.positions;
    }
    const steps = Math.max(1, Math.ceil(dt / this.material.maxSubstep - 1e-10)), h = dt / steps;
    for (let i = 0; i < steps; i++) this._substep(h, force);
    for (let i = 0; i < this.positions.length; i++) this.displacements[i] = this.positions[i] - this.restPositions[i];
    return this.positions;
  }

  report() {
    const zoneVolumeErrors = this._zones.map(zone => zone.tets.reduce((sum,t)=>sum+this._volumeGradient(t)*this._restVolume[t],0)/zone.volume-1);
    return { ...this._measure(), ...this._stats, nodeCount: this.nodeCount, tetCount: this.tetCount, zones: this._zones.length, zoneVolumeErrors,
      model: 'tetrahedral-xpbd-green-strain-local-and-zonal-volume', material: { ...this.material } };
  }
}
