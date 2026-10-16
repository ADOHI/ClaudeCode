// Node helpers around bust-bind/1 exports (tools/README.md) for the
// morphometric tools: decode, choose the triangles to measure, bake the field
// targets with web/src/core/bake.js and prepare a morphometric context.
import fs from 'node:fs';
import { createBustField, DEFAULT_PARAMS, cloneParams, sliderToWeights } from '../../web/src/core/field.js';
import { bakeMesh } from '../../web/src/core/bake.js';
import { autoFitAnchor } from '../../web/src/core/autofit.js';
import { m4Linear, m3Vec } from '../../web/src/core/vec.js';
import { prepareMorpho, selectTriangles, SKIN_MATERIALS, NON_TORSO_MATERIALS } from '../../web/src/core/morpho.js';

const decode = (b64, T) => {
  if (!b64) return null;
  const u = Buffer.from(b64, 'base64');
  const copy = new Uint8Array(u.byteLength);
  copy.set(u);
  return new T(copy.buffer);
};

/** Parse a bust-bind/1 object (or file path) into typed arrays. */
export function loadBind(src) {
  const j = typeof src === 'string' ? JSON.parse(fs.readFileSync(src, 'utf8')) : src;
  if (j.format !== 'bust-bind/1') throw new Error(`not bust-bind/1: ${j.format}`);
  const meshes = j.meshes.map((m) => ({
    name: m.name,
    pos: decode(m.positions, Float32Array),
    normals: decode(m.normals, Float32Array),
    index: decode(m.index, Uint32Array),
    mask: decode(m.mask, Float32Array),
    bindMatrix: m.bindMatrix,
    groups: m.groups ?? [],
  }));
  return { ...j, meshes };
}

// Material selections. 'outer' = what you see (torso skin + clothes, no hair /
// face / accessories), 'skin' = body skin only (often cut out under clothes).
export const SELECTIONS = {
  outer: { exclude: NON_TORSO_MATERIALS },
  skin: { include: SKIN_MATERIALS, exclude: /face|eye|brow|hair/i },
  all: {},
};

/**
 * Field params the viewer would use for this export: DEFAULT_PARAMS with the
 * anchor re-fitted by autoFitAnchor (as the viewer does on load).
 */
export function viewerParams(bind, base = DEFAULT_PARAMS) {
  const params = cloneParams(base);
  const fit = autoFitAnchor(bind.frame, bind.meshes.map((m) => ({ pos: m.pos, index: m.index, mask: m.mask })), params.depth);
  if (fit) params.anchor = { x: +fit.anchor.x.toFixed(3), y: +fit.anchor.y.toFixed(3), z: +fit.anchor.z.toFixed(3) };
  return { params, fit };
}

/** Bake every target of `params` into bind-space deltas per mesh. */
export function bakeBind(bind, params) {
  const field = createBustField(bind.frame, params);
  const deltas = bind.meshes.map((m) => {
    const res = bakeMesh({ positions: m.pos, normals: null, bindMatrix: m.bindMatrix, mask: m.mask }, field, field.targets);
    const L = m4Linear(m.bindMatrix);
    const out = {};
    for (const t of field.targets) {
      const dl = res.targets[t].dPos;
      const db = new Float32Array(dl.length);
      for (let i = 0; i < dl.length; i += 3) db.set(m3Vec(L, [dl[i], dl[i + 1], dl[i + 2]]), i);
      out[t] = db;
    }
    return out;
  });
  return { field, deltas };
}

/** Shoulder (upper-arm joint) height in the body frame, S units. */
export function shoulderY(bind) {
  const f = bind.frame, b = bind.bonePositions ?? {};
  const ys = ['leftUpperArm', 'rightUpperArm'].filter((k) => b[k]).map((k) => {
    const p = b[k];
    return ((p[0] - f.origin[0]) * f.up[0] + (p[1] - f.origin[1]) * f.up[1] + (p[2] - f.origin[2]) * f.up[2]) / f.S;
  });
  return ys.length ? ys.reduce((a, c) => a + c, 0) / ys.length : null;
}

/**
 * Morphometric context for one material selection.
 * @returns {{ctx, field, params, fit, triangles}}
 */
export function prepareBind(bind, { selection = 'outer', params = null, opts = {} } = {}) {
  const vp = params ? { params, fit: null } : viewerParams(bind);
  const { field, deltas } = bakeBind(bind, vp.params);
  const sel = typeof selection === 'string' ? SELECTIONS[selection] : selection;
  let triangles = 0;
  const meshes = bind.meshes.map((m, i) => {
    const tris = selectTriangles(m.index, m.pos.length / 3, m.groups, sel);
    triangles += tris.length / 3;
    return { pos: m.pos, tris, mask: m.mask, deltas: deltas[i] };
  });
  const ctx = prepareMorpho({ frame: bind.frame, meshes, apex: field.sides.map((s) => s.apex), opts, shoulderY: shoulderY(bind) });
  return { ctx, field, params: vp.params, fit: vp.fit, triangles };
}

// Named slider states used by the reports and the contact sheet.
export const STATES = {
  base: {},
  size_up_natural: { bust_size_up_natural: 1 },
  size_up_stylized: { bust_size_up_stylized: 1 },
  size_down: { bust_size_down: 1 },
  lift_up: { bust_lift_up: 1 },
  lift_down: { bust_lift_down: 1 },
  spread_out: { bust_spread_out: 1 },
  spread_in: { bust_spread_in: 1 },
};

/** Weights for a state given by name, by raw weights, or by sliders {size, style, lift, spread}. */
export function stateWeights(s) {
  if (typeof s === 'string') {
    if (!(s in STATES)) throw new Error(`unknown state ${s} (known: ${Object.keys(STATES).join(', ')})`);
    return STATES[s];
  }
  if (s && ('size' in s || 'style' in s || 'lift' in s || 'spread' in s)) return sliderToWeights(s);
  return s ?? {};
}
