// Validate imported research files before they reach the field evaluator.
import { DEFAULT_PARAMS, TARGETS, cloneParams } from '../core/field.js';

const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const check = (ok, path) => { if (!ok) throw new Error(`Invalid ${path}`); };
const number = (x, path, lo = -Infinity, hi = Infinity) => check(typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi, path);
const vector = (x, n, path) => { check(Array.isArray(x) && x.length === n, path); x.forEach((v, i) => number(v, `${path}[${i}]`)); };

export function parseParams(input) {
  const src = typeof input === 'string' ? JSON.parse(input) : input;
  check(object(src), 'params JSON');
  if (src.format !== undefined) check(src.format === 'bust-morph-params/1', 'params format');
  const p = cloneParams(src.params ?? src);
  check(object(p.anchor) && object(p.window) && object(p.targets), 'anchor/window/targets');
  for (const k of ['x', 'y', 'z']) number(p.anchor[k], `anchor.${k}`, k === 'x' ? 0 : -Infinity);
  number(p.depth, 'depth', Number.MIN_VALUE);
  for (const k of ['x', 'yUp', 'yDown', 'zFront', 'zBack']) number(p.window[k], `window.${k}`, Number.MIN_VALUE);
  for (const k of ['hardness', 'hardnessZ']) { number(p.window[k], `window.${k}`, 0, 1); check(p.window[k] < 1, `window.${k} < 1`); }
  p.kernel ??= DEFAULT_PARAMS.kernel;
  check(['kelvinlet', 'smooth'].includes(p.kernel), 'kernel');
  for (const k of ['midline', 'midlineLock']) { p[k] ??= DEFAULT_PARAMS[k]; number(p[k], k, 0); }
  p.mask = { ...DEFAULT_PARAMS.mask, ...p.mask };
  for (const k of ['excludeHead', 'excludeArms']) check(typeof p.mask[k] === 'boolean', `mask.${k}`);
  for (const name of TARGETS) check(Array.isArray(p.targets[name]), `targets.${name}`);
  for (const [name, ops] of Object.entries(p.targets)) {
    check(/^[A-Za-z0-9_.-]+$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name), `target name ${name}`);
    check(Array.isArray(ops), `targets.${name}`);
    ops.forEach((op, i) => {
      const path = `targets.${name}[${i}]`;
      check(object(op) && ['grab', 'scale', 'linear'].includes(op.type), path);
      vector(op.at, 3, `${path}.at`);
      if (op.type === 'linear') vector(op.A, 9, `${path}.A`);
      if (op.type === 'grab') vector(op.d, 3, `${path}.d`);
      if (op.type === 'scale' && op.k !== undefined) number(op.k, `${path}.k`);
      if (op.type !== 'linear' || op.radius !== undefined) number(op.radius, `${path}.radius`, op.type === 'linear' ? 0 : Number.MIN_VALUE);
      if (op.nu !== undefined) number(op.nu, `${path}.nu`, 0, 0.5);
      if (op.parity !== undefined) check(op.parity === 1 || op.parity === -1, `${path}.parity`);
    });
  }
  return p;
}

// Preserve object identities: lil-gui controllers retain references to them.
export function applyParams(destination, source) {
  const p = parseParams(source);
  for (const k of ['anchor', 'window', 'mask']) Object.assign(destination[k], p[k]);
  for (const k of ['depth', 'kernel', 'midline', 'midlineLock', 'targets']) destination[k] = p[k];
  return destination;
}

export function parseProfile(input) {
  const p = typeof input === 'string' ? JSON.parse(input) : cloneParams(input);
  check(object(p) && p.format === 'bust-character-profile/1', 'character profile format');
  check(typeof p.name === 'string' && p.name.trim().length > 0, 'profile.name');
  p.bones ??= {};
  check(object(p.bones), 'profile.bones');
  const keys = ['hips', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];
  for (const [k, v] of Object.entries(p.bones)) check(keys.includes(k) && typeof v === 'string' && v.length > 0, `profile.bones.${k}`);
  p.materials ??= [];
  check(Array.isArray(p.materials), 'profile.materials');
  for (const m of p.materials) {
    check(object(m) && typeof m.material === 'string' && (!m.mesh || typeof m.mesh === 'string'), 'profile.material');
    check(['skin', 'garment', 'exclude'].includes(m.role), 'profile.material.role');
    if (m.tier !== undefined) check([0, 1, 2].includes(m.tier), 'profile.material.tier');
    if (m.thickness !== undefined) number(m.thickness, 'profile.material.thickness', 0);
  }
  // Region overrides use the same units/constraints as field params.
  const region = { ...cloneParams(DEFAULT_PARAMS), ...p.region, anchor: { ...DEFAULT_PARAMS.anchor, ...p.region?.anchor }, window: { ...DEFAULT_PARAMS.window, ...p.region?.window } };
  parseParams(region);
  if (p.morphPrefix !== undefined) check(typeof p.morphPrefix === 'string' && /^[A-Za-z0-9_.-]*$/.test(p.morphPrefix), 'profile.morphPrefix');
  return p;
}

export function materialRule(profile, mesh, material) {
  return profile?.materials.find((r) => r.material === material && r.mesh === mesh)
    ?? profile?.materials.find((r) => r.material === material && !r.mesh)
    ?? null;
}
