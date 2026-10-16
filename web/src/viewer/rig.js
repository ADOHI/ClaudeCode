// Glue between three.js meshes and the engine-agnostic core: extract bind
// data, bake, attach morph targets, drive weights, visualize, validate.

import * as THREE from 'three';
import { buildBodyFrame, createBustField } from '../core/field.js';
import { bakeMesh, computeMask } from '../core/bake.js';
import { autoFitAnchor } from '../core/autofit.js';
import { fieldCheck, meshCheck, normalCheck } from '../core/validate.js';
import { m4Point, m4Linear, m3Vec, m3Inverse } from '../core/vec.js';
import { meshBindData, boneBindPosition } from './model.js';

export class BustRig {
  constructor({ root, vrm, meshes, bones }) {
    this.root = root;
    this.vrm = vrm;
    this.meshes = meshes;
    this.bones = bones;
    this.entries = [];
    this.heat = false;
  }

  missingBones() {
    return ['hips', 'chest', 'neck', 'leftUpperArm', 'rightUpperArm'].filter((k) => !this.bones[k]);
  }

  bindPos(key) {
    return boneBindPosition(this.bones[key], this.meshes);
  }

  prepare(maskOpts) {
    const b = (k) => this.bindPos(k);
    this.frame = buildBodyFrame({
      hips: b('hips'),
      chest: b('chest'),
      neck: b('neck'),
      leftUpperArm: b('leftUpperArm'),
      rightUpperArm: b('rightUpperArm'),
    });
    const seen = new Set();
    this.entries = [];
    for (const mesh of this.meshes) {
      if (seen.has(mesh.geometry.uuid)) continue; // shared geometry: bake once
      seen.add(mesh.geometry.uuid);
      if (!mesh.isSkinnedMesh) continue; // Unity: only SkinnedMeshRenderer has blend shapes
      const d = meshBindData(mesh, this.bones, maskOpts);
      d.mask = d.excluded && d.skinIndex ? computeMask(d.skinIndex, d.skinWeight, d.skinItemSize, d.positions.length / 3, d.excluded) : null;
      const n = d.positions.length / 3;
      d.posBind = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        d.posBind.set(m4Point(d.bindMatrix, [d.positions[v * 3], d.positions[v * 3 + 1], d.positions[v * 3 + 2]]), v * 3);
      }
      this.entries.push({ mesh, ...d });
    }
  }

  autoFit(params) {
    return autoFitAnchor(
      this.frame,
      this.entries.map((e) => ({ pos: e.posBind, index: e.index, mask: e.mask })),
      params.depth,
    );
  }

  bake(params) {
    const t0 = performance.now();
    this.params = params;
    this.field = createBustField(this.frame, params);
    const names = this.field.targets;
    this.baked = [];
    let touched = 0;
    for (const e of this.entries) {
      const res = bakeMesh(e, this.field, names);
      e.result = res;
      if (res.touched === 0) {
        detachTargets(e.mesh);
        continue;
      }
      touched += res.touched;
      attachTargets(e.mesh, res.targets, names);
      this.baked.push(e);
    }
    this.bakeMs = performance.now() - t0;
    this.touched = touched;
    if (this.heat) this.setHeatmap(true);
    return { ms: this.bakeMs, touched, meshes: this.baked.length };
  }

  setWeights(weights) {
    for (const e of this.baked) {
      const dict = e.mesh.morphTargetDictionary;
      for (const [name, w] of Object.entries(weights)) {
        const i = dict[name];
        if (i !== undefined) e.mesh.morphTargetInfluences[i] = w;
      }
    }
  }

  // Everything a bake-time tool (Python teacher / distiller / Blender port)
  // needs, in bind space. Typed arrays are base64 so the file stays compact.
  // Format: bust-bind/1 (see docs/METHOD.md).
  exportBind() {
    const b64 = (ta) => {
      const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const L = (e) => m4Linear(e.bindMatrix);
    return {
      format: 'bust-bind/1',
      frame: this.frame,
      params: this.params,
      bones: Object.fromEntries(Object.entries(this.bones).map(([k, v]) => [k, v?.name ?? null])),
      bonePositions: Object.fromEntries(Object.keys(this.bones).filter((k) => this.bones[k]).map((k) => [k, this.bindPos(k)])),
      meshes: this.entries.map((e) => {
        const n = e.positions.length / 3;
        const nb = new Float32Array(n * 3);
        if (e.normals) {
          // normals to bind space: inverse-transpose of the linear part
          const Linv = m3Inverse(L(e));
          const LinvT = [Linv[0], Linv[3], Linv[6], Linv[1], Linv[4], Linv[7], Linv[2], Linv[5], Linv[8]];
          for (let v = 0; v < n; v++) {
            const r = m3Vec(LinvT, [e.normals[v * 3], e.normals[v * 3 + 1], e.normals[v * 3 + 2]]);
            const l = Math.hypot(r[0], r[1], r[2]) || 1;
            nb.set([r[0] / l, r[1] / l, r[2] / l], v * 3);
          }
        }
        return {
          name: e.mesh.name || '(mesh)',
          vertexCount: n,
          // positions/normals in bind space; index = triangle list (null => sequential)
          positions: b64(e.posBind),
          normals: e.normals ? b64(nb) : null,
          index: e.index ? b64(Uint32Array.from(e.index)) : null,
          mask: e.mask ? b64(e.mask) : null,
          // local -> bind (column-major), to bring deltas back into mesh space
          bindMatrix: e.bindMatrix,
        };
      }),
    };
  }

  validate() {
    const t0 = performance.now();
    const field = fieldCheck(this.field);
    const names = this.field.targets;
    const meshes = this.baked.map((e) => {
      const L = m4Linear(e.bindMatrix);
      const deltas = {};
      for (const t of names) {
        const dl = e.result.targets[t].dPos;
        const db = new Float32Array(dl.length);
        for (let i = 0; i < dl.length; i += 3) db.set(m3Vec(L, [dl[i], dl[i + 1], dl[i + 2]]), i);
        deltas[t] = db;
      }
      return { name: e.mesh.name, pos: e.posBind, index: e.index, deltas };
    });
    const mesh = meshes.length ? meshCheck(meshes, this.frame.S) : null;
    // Analytic vs geometric normals on the most affected mesh.
    let normals = null;
    const main = [...this.baked].sort((a, b) => b.result.touched - a.result.touched)[0];
    if (main) {
      const t = 'bust_size_up_stylized';
      const r = main.result.targets[t];
      normals = normalCheck(main.positions, main.index, main.normals, r.dPos, r.dNrm, this.frame.S);
      normals.mesh = main.mesh.name;
      normals.target = t;
    }
    return { field, mesh, normals, ms: performance.now() - t0 };
  }

  setHeatmap(on) {
    this.heat = on;
    for (const e of this.entries) {
      const m = e.mesh;
      if (on) {
        if (!m.userData.bustOrigMaterial) m.userData.bustOrigMaterial = m.material;
        const n = e.positions.length / 3;
        const col = new Float32Array(n * 3);
        const c = new THREE.Color();
        for (let v = 0; v < n; v++) {
          const p = [e.posBind[v * 3], e.posBind[v * 3 + 1], e.posBind[v * 3 + 2]];
          const w = (this.field ? this.field.weight(p) : 0) * (e.mask ? e.mask[v] : 1);
          c.setHSL(0.66 * (1 - w), 0.9, w > 0 ? 0.5 : 0.25);
          col.set([c.r, c.g, c.b], v * 3);
        }
        m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
        m.material = Array.isArray(m.userData.bustOrigMaterial) ? m.userData.bustOrigMaterial.map(() => mat) : mat;
      } else if (m.userData.bustOrigMaterial) {
        m.material = m.userData.bustOrigMaterial;
        delete m.userData.bustOrigMaterial;
      }
    }
  }
}

// Append our targets after the model's own morph targets (VRM expressions
// etc. keep their indices). Re-baking replaces only our targets.
function attachTargets(mesh, targets, names) {
  const g = mesh.geometry;
  if (!g.userData.bustBase) {
    g.userData.bustBase = {
      pos: (g.morphAttributes.position ?? []).slice(),
      nrm: (g.morphAttributes.normal ?? []).slice(),
    };
  }
  const base = g.userData.bustBase;
  const rel = g.morphTargetsRelative || base.pos.length === 0;
  g.morphTargetsRelative = rel;
  const pos = base.pos.slice();
  let nrm = base.nrm.slice();
  if (nrm.length !== pos.length) {
    // Existing targets without normals: zero normal deltas (or base normals
    // for absolute targets) so the counts line up.
    nrm = pos.map((a) => {
      const z = new THREE.Float32BufferAttribute(rel ? new Float32Array(a.count * 3) : g.attributes.normal.array.slice(), 3);
      z.name = a.name;
      return z;
    });
  }
  const basePos = g.attributes.position, baseNrm = g.attributes.normal;
  for (const name of names) {
    const t = targets[name];
    let dp = t.dPos, dn = t.dNrm ?? new Float32Array(dp.length);
    if (!rel) {
      dp = dp.slice();
      dn = dn.slice();
      for (let v = 0; v < basePos.count; v++) {
        dp[v * 3] += basePos.getX(v); dp[v * 3 + 1] += basePos.getY(v); dp[v * 3 + 2] += basePos.getZ(v);
        dn[v * 3] += baseNrm.getX(v); dn[v * 3 + 1] += baseNrm.getY(v); dn[v * 3 + 2] += baseNrm.getZ(v);
      }
    }
    const pa = new THREE.Float32BufferAttribute(dp, 3);
    pa.name = name;
    const na = new THREE.Float32BufferAttribute(dn, 3);
    na.name = name;
    pos.push(pa);
    nrm.push(na);
  }
  replaceMorphs(mesh, pos, nrm);
}

function detachTargets(mesh) {
  const base = mesh.geometry.userData.bustBase;
  if (!base) return;
  replaceMorphs(mesh, base.pos.slice(), base.nrm.slice());
}

function replaceMorphs(mesh, pos, nrm) {
  const g = mesh.geometry;
  const old = mesh.morphTargetInfluences ? mesh.morphTargetInfluences.slice() : [];
  const keep = g.userData.bustBase.pos.length;
  if (pos.length) {
    g.morphAttributes.position = pos;
    g.morphAttributes.normal = nrm.length === pos.length ? nrm : undefined;
    if (!g.morphAttributes.normal) delete g.morphAttributes.normal;
  } else {
    delete g.morphAttributes.position;
    delete g.morphAttributes.normal;
  }
  mesh.updateMorphTargets();
  if (mesh.morphTargetInfluences) for (let i = 0; i < keep; i++) mesh.morphTargetInfluences[i] = old[i] ?? 0;
  g.dispose(); // drop cached morph textures / buffers; re-uploaded next frame
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) m.needsUpdate = true;
}
