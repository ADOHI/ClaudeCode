// Bake the bust field into per-vertex blend shape deltas.
//
// Output layout matches what both target pipelines store:
//   - Blender shape key: absolute positions (= base + dPos) in mesh local space
//   - Unity Mesh.AddBlendShapeFrame(name, 100, deltaVertices, deltaNormals, null)
//     with deltas in mesh local space.

import { m4Point, m4Linear, m3Vec, m3Inverse, m3Transpose, normalize, clamp } from './vec.js';

// Per-vertex mask from skin weights: 1 - (sum of weights on excluded bones).
// `excluded` is a Set of bone indices (into this mesh's skin palette).
export function computeMask(skinIndex, skinWeight, itemSize, vertexCount, excluded) {
  const mask = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    let ex = 0;
    for (let k = 0; k < itemSize; k++) {
      const w = skinWeight[v * itemSize + k];
      if (w > 0 && excluded.has(skinIndex[v * itemSize + k])) ex += w;
    }
    mask[v] = clamp(1 - ex, 0, 1);
  }
  return mask;
}

/**
 * @param {object} mesh
 * @param {Float32Array} mesh.positions  local-space positions (xyz * n)
 * @param {Float32Array|null} mesh.normals local-space normals (xyz * n)
 * @param {number[]} mesh.bindMatrix column-major 4x4, local -> bind space
 * @param {Float32Array|null} mesh.mask per-vertex 0..1 (null = all 1)
 * @param {object} field from createBustField
 * @returns {{targets: Object<string,{dPos: Float32Array, dNrm: Float32Array|null, nonZero: number, maxLen: number}>, touched: number}}
 */
export function bakeMesh(mesh, field, targets = field.targets) {
  const { positions, normals, bindMatrix, mask } = mesh;
  const n = positions.length / 3;
  const L = m4Linear(bindMatrix);
  const Linv = m3Inverse(L);
  const LT = m3Transpose(L);
  const LinvT = m3Transpose(Linv);

  const out = {};
  for (const t of targets) {
    out[t] = { dPos: new Float32Array(n * 3), dNrm: normals ? new Float32Array(n * 3) : null, nonZero: 0, maxLen: 0 };
  }
  let touched = 0;

  for (let v = 0; v < n; v++) {
    const m = mask ? mask[v] : 1;
    if (m <= 0) continue;
    const pl = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const p = m4Point(bindMatrix, pl);
    if (field.weight(p) === 0) continue;
    touched++;

    let nl = null, nb = null;
    if (normals) {
      nl = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      nb = normalize(m3Vec(LinvT, nl)); // normal into bind space
    }

    for (const t of targets) {
      const d = field.delta(t, p);
      const db = [d[0] * m, d[1] * m, d[2] * m];
      const dl = m3Vec(Linv, db);
      const o = out[t];
      o.dPos[v * 3] = dl[0];
      o.dPos[v * 3 + 1] = dl[1];
      o.dPos[v * 3 + 2] = dl[2];
      const len = Math.hypot(dl[0], dl[1], dl[2]);
      if (len > 0) o.nonZero++;
      if (len > o.maxLen) o.maxLen = len;

      if (nb) {
        // Deformation gradient F = I + m * J; normals transform by F^-T.
        const J = field.jacobian(t, p);
        const F = [
          1 + m * J[0], m * J[1], m * J[2],
          m * J[3], 1 + m * J[4], m * J[5],
          m * J[6], m * J[7], 1 + m * J[8],
        ];
        const Finv = m3Inverse(F);
        if (!Finv) continue;
        const nb2 = normalize(m3Vec(m3Transpose(Finv), nb));
        // Back to local space (inverse of L^-T is L^T), keep original length.
        const nl2 = normalize(m3Vec(LT, nb2));
        const len0 = Math.hypot(nl[0], nl[1], nl[2]);
        o.dNrm[v * 3] = nl2[0] * len0 - nl[0];
        o.dNrm[v * 3 + 1] = nl2[1] * len0 - nl[1];
        o.dNrm[v * 3 + 2] = nl2[2] * len0 - nl[2];
      }
    }
  }
  return { targets: out, touched };
}
