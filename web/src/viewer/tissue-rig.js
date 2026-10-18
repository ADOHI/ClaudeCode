// PC research viewer: distributed volumetric dynamics, shared by skin/clothes.
// Static slider morphs remain baked; this adds a live bind-space deformation.
import { TissueVolume } from '../core/tissue.js';
import { buildTissueProxy } from '../core/tissue-proxy.js';
import { fitTissueRegion } from '../core/tissue-region.js';
import { detCoefficients, safeTransferScale } from '../core/tissue-transfer.js';
import { ChestTracker, poseAxes } from '../core/runtime.js';
import { m4Linear, m3Vec, m3Inverse, m3Transpose, m3Det, normalize } from '../core/vec.js';
import { selectTriangles, NON_TORSO_MATERIALS } from '../core/morpho.js';
import { materialRule } from './config.js';

const H = 1e-3;
const gravity = [0, -9.81, 0];

export class TissueRig {
  constructor(rig, restWeights, restAxes, material = {}) {
    this.rig = rig;
    this.frame = rig.frame;
    this.restAxes = poseAxes(restAxes);
    this.tracker = new ChestTracker();
    this.meshes = [];
    const sources = [];
    for (const e of rig.entries) {
      const L = m4Linear(e.bindMatrix), Linv = m3Inverse(L);
      const pos = Float64Array.from(e.posBind);
      const allowed = new Float64Array(e.positions.length / 3);
      const groups = rig.materialGroups(e.mesh).filter(g => {
        const rule = materialRule(rig.profile, e.mesh.name, g.material);
        return rule ? rule.role !== 'exclude' : !NON_TORSO_MATERIALS.test(g.material);
      });
      const tris = groups.length ? selectTriangles(e.index, allowed.length, groups) : new Uint32Array();
      for (const v of tris) allowed[v] = e.mask ? e.mask[v] : 1;
      for (const [name, w] of Object.entries(restWeights)) {
        const d = e.result?.targets[name]?.dPos;
        if (!d || !w) continue;
        for (let i = 0; i < d.length; i += 3) {
          const b = m3Vec(L, [d[i], d[i + 1], d[i + 2]]);
          for (let k = 0; k < 3; k++) pos[i + k] += w * b[k];
        }
      }
      sources.push({ pos, index: tris, mask: allowed });
      this.meshes.push({ e, pos, allowed, L, Linv, LT: m3Transpose(L), LinvT: m3Transpose(Linv) });
    }
    // Attachments belong to the authored chest wall. Re-detecting the fold on
    // each size morph can jump to another garment crease and shrink the cage
    // when the bust grows. Keep the fitted footprint; fit its live front/depth
    // to the statically morphed surface below.
    const restSources = sources.map((s, i) => ({ ...s, pos: this.meshes[i].e.posBind }));
    const region = fitTissueRegion({ frame: this.frame, params: rig.params, meshes: restSources, wallInset: material.wallInset });
    this.proxy = buildTissueProxy({ frame: this.frame, params: rig.params, meshes: sources, region, coverage: material.coverage });
    this.solver = new TissueVolume({ positions: this.proxy.positions, tets: this.proxy.tets, fixed: this.proxy.fixed, ...material });
    const f = this.frame, axes = [f.left, f.up, f.forward];
    for (const m of this.meshes) {
      const base = this.proxy.embed(m.pos, m.allowed);
      m.active = base.active;
      m.coreRadii = base.coreRadii;
      m.mobility = new Float64Array(base.count);
      for (const v of base.active) for (let q = v * 8; q < v * 8 + 8; q++) {
        if (!this.proxy.fixed[base.indices[q]]) m.mobility[v] += base.weights[q] * base.mask[v];
      }
      const probes = new Float64Array(m.active.length * 7 * 3), masks = new Float64Array(m.active.length * 7);
      for (let j = 0; j < m.active.length; j++) {
        const v = m.active[j];
        for (let q = 0; q < 7; q++) {
          const i = (j * 7 + q) * 3;
          probes.set(m.pos.subarray(v * 3, v * 3 + 3), i);
          masks[j * 7 + q] = m.allowed[v];
          if (q) {
            const axis = axes[Math.floor((q - 1) / 2)], sign = q % 2 ? 1 : -1;
            for (let k = 0; k < 3; k++) probes[i + k] += sign * axis[k] * H * f.S;
          }
        }
      }
      m.embedding = this.proxy.embed(probes, masks);
      m.displacement = new Float64Array(probes.length);
    }
    this.ms = 0;
    this.normalGuards = 0;
    this.transferMinDet = 1;
    this.transferScale = 1;
    this.maxMappedDisplacement = 0;
    this.trackerStatus = 'reset';
    this.resetCount = 0;
    this.lastReset = null;
    this.transferCoefficients = new Float64Array(this.meshes.reduce((n,m)=>n+m.active.length,0)*3);
  }

  reset(reason = 'manual') {
    this.tracker.reset(); this.solver.reset();
    this.resetCount++;
    this.lastReset = reason;
  }

  update(dt, pose, weights, material) {
    const start = performance.now();
    const tracked = this.tracker.push(dt, pose.pos, poseAxes(pose), pose.S, gravity, this.restAxes);
    this.trackerStatus = tracked.status;
    if (tracked.status === 'cut') this.reset(tracked.reason ?? 'motion cut');
    for (const step of tracked.steps ?? []) {
      this.solver.advanceTracked(step, material);
    }
    if(this.maxMappedDisplacement>1e-12 || this.solver.displacements.some(x=>Math.abs(x)>1e-12)) this.apply(weights, dt);
    this.ms = performance.now() - start;
  }

  apply(weights, dt) {
    const f = this.frame, axes = [f.left, f.up, f.forward];
    for (const m of this.meshes) this.proxy.displacement(m.embedding, this.solver.positions, m.displacement);
    // A valid tet cage alone does not certify its masked/shell transfer field.
    // Bound the displayed shared map too, scaling every layer identically.
    let ci=0;
    for (const m of this.meshes) for (let j=0;j<m.active.length;j++) {
      const D=m.displacement, di=j*21, A=new Array(9);
      for(let c=0;c<3;c++) for(let r=0;r<3;r++) A[r*3+c]=(D[di+(1+c*2)*3+r]-D[di+(2+c*2)*3+r])/(2*H);
      this.transferCoefficients.set(detCoefficients(A),ci); ci+=3;
    }
    const target=safeTransferScale(this.transferCoefficients);
    const recovered=this.transferScale+(target-this.transferScale)*(-Math.expm1(-12*Math.max(0,dt)));
    this.transferScale=Math.min(target,recovered);
    this.transferMinDet = 1;
    this.maxMappedDisplacement = 0;
    for (const m of this.meshes) {
      const { e } = m, attr = e.mesh.geometry.attributes;
      const D = m.displacement, scale = this.transferScale;
      const normalTargets = Object.entries(weights).filter(([name, w]) => w && e.result?.targets[name]?.dNrm);
      for (let j = 0; j < m.active.length; j++) {
        const v = m.active[j], vi = v * 3, di = j * 21;
        this.maxMappedDisplacement = Math.max(this.maxMappedDisplacement, scale * Math.hypot(D[di], D[di+1], D[di+2]));
        const bindD = axes[0].map((_, k) => scale * f.S * (axes[0][k] * D[di] + axes[1][k] * D[di + 1] + axes[2][k] * D[di + 2]));
        const localD = m3Vec(m.Linv, bindD);
        attr.position.setXYZ(v, e.positions[vi] + localD[0], e.positions[vi + 1] + localD[1], e.positions[vi + 2] + localD[2]);
        if (!e.normals) continue;
        const F = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) F[row * 3 + col] += scale * (D[di + (1 + col * 2) * 3 + row] - D[di + (2 + col * 2) * 3 + row]) / (2 * H);
        const det = m3Det(F), inverse = det > 0.05 ? m3Inverse(F) : null;
        this.transferMinDet = Math.min(this.transferMinDet, det);
        const localStatic = [e.normals[vi], e.normals[vi + 1], e.normals[vi + 2]];
        for (const [name, w] of normalTargets) {
          const n = e.result.targets[name].dNrm;
          for (let k = 0; k < 3; k++) localStatic[k] += w * n[vi + k];
        }
        let corrected = normalize(localStatic);
        if (inverse) {
          const nb = normalize(m3Vec(m.LinvT, localStatic));
          const body = axes.map(axis => axis.reduce((sum, x, k) => sum + x * nb[k], 0));
          const deformed = normalize(m3Vec(m3Transpose(inverse), body));
          const bindN = axes[0].map((_, k) => axes[0][k] * deformed[0] + axes[1][k] * deformed[1] + axes[2][k] * deformed[2]);
          corrected = normalize(m3Vec(m.LT, bindN));
        } else this.normalGuards++;
        attr.normal.setXYZ(v, e.normals[vi] + corrected[0] - localStatic[0], e.normals[vi + 1] + corrected[1] - localStatic[1], e.normals[vi + 2] + corrected[2] - localStatic[2]);
      }
      if (m.active.length) {
        attr.position.needsUpdate = true;
        if (attr.normal) attr.normal.needsUpdate = true;
      }
    }
  }

  report() {
    const bands = Object.fromEntries(['tip', 'body', 'base', 'collar'].map(k => [k, { vertices:0, mean:0, max:0 }]));
    for (const m of this.meshes) for (let j = 0; j < m.active.length; j++) {
      const v = m.active[j], r = m.coreRadii[v], key = r < 0.45 ? 'tip' : r < 0.8 ? 'body' : r <= 1.05 ? 'base' : 'collar';
      const d = this.transferScale * Math.hypot(...m.displacement.subarray(j * 21, j * 21 + 3));
      const b = bands[key]; b.vertices++; b.mean += d; b.max = Math.max(b.max, d);
    }
    for (const b of Object.values(bands)) if (b.vertices) b.mean /= b.vertices;
    return { ...this.solver.report(), proxy: this.proxy.info, mappedVertices: this.meshes.reduce((n, m) => n + m.active.length, 0), ms: this.ms,
      transferMinDet: this.transferMinDet, transferScale: this.transferScale, maxMappedDisplacement: this.maxMappedDisplacement, normalGuards: this.normalGuards,
      trackerStatus: this.trackerStatus, resetCount: this.resetCount, lastReset: this.lastReset, motionBands: bands };
  }

  coverage() { return new Map(this.meshes.map(m => [m.e.mesh, m.mobility])); }

  dispose() {
    for (const { e } of this.meshes) {
      const a = e.mesh.geometry.attributes;
      a.position.array.set(e.positions); a.position.needsUpdate = true;
      if (e.normals && a.normal) { a.normal.array.set(e.normals); a.normal.needsUpdate = true; }
    }
  }
}
