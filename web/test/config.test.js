import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, cloneParams } from '../src/core/field.js';
import { withRuntimeTargets } from '../src/core/runtime.js';
import { parseParams, applyParams, parseProfile, materialRule } from '../src/viewer/config.js';

test('raw distilled params and viewer export round trip, including signed runtime ops', () => {
  const raw = withRuntimeTargets(DEFAULT_PARAMS);
  assert.deepEqual(parseParams(JSON.stringify(raw)), raw);
  assert.deepEqual(parseParams({ format: 'bust-morph-params/1', params: raw, sliders: {} }), raw);
});

test('invalid JSON fields fail before bake; preset updates preserve GUI object references', () => {
  for (const mutate of [p => p.depth = 0, p => p.window.hardness = 1, p => p.anchor.x = -1,
    p => p.targets.bust_lift_up[0].radius = 0, p => p.targets.bust_lift_up[0].d = [1, 2],
    p => p.targets.bust_lift_up[0].parity = 0, p => delete p.targets.bust_size_down]) {
    const p = cloneParams(DEFAULT_PARAMS); mutate(p); assert.throws(() => parseParams(p), /Invalid/);
  }
  const dst = cloneParams(DEFAULT_PARAMS), anchor = dst.anchor, window = dst.window, mask = dst.mask;
  const p = cloneParams(DEFAULT_PARAMS); p.anchor.x = 0.33; p.window.yUp = 0.6; p.mask.excludeArms = false;
  applyParams(dst, p);
  assert.equal(dst.anchor, anchor); assert.equal(dst.window, window); assert.equal(dst.mask, mask);
  assert.equal(dst.anchor.x, 0.33); assert.equal(dst.window.yUp, 0.6); assert.equal(dst.mask.excludeArms, false);
  assert.equal(DEFAULT_PARAMS.anchor.x, 0.24);
});

test('profiles validate explicit roles and region bounds; mesh-specific roles take precedence', () => {
  const p = parseProfile({ format: 'bust-character-profile/1', name: 'Test adult', bones: { chest: '胸' },
    region: { anchor: { x: 0.25 } }, materials: [{ material: 'UP', role: 'garment', tier: 0, thickness: 0.005 },
      { mesh: 'accessory', material: 'UP', role: 'exclude' }] });
  assert.equal(materialRule(p, 'body', 'UP').role, 'garment');
  assert.equal(materialRule(p, 'accessory', 'UP').role, 'exclude');
  assert.throws(() => parseProfile({ ...p, region: { depth: 0 } }), /Invalid/);
  assert.throws(() => parseProfile({ ...p, bones: { chset: '胸' } }), /Invalid/);
  assert.throws(() => parseProfile({ ...p, materials: [{ material: 'UP', role: 'other' }] }), /Invalid/);
});
