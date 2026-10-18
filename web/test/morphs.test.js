import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { makeMorphsRelative } from '../src/viewer/morphs.js';

test('absolute morph conversion preserves non-unit blends and a live base displacement', () => {
  const geometry = new BufferGeometry();
  for (const name of ['position', 'normal']) {
    const base = name === 'position' ? [1, 2, 3, -2, 4, 1] : [0, 0, 1, 0, 1, 0];
    geometry.setAttribute(name, new Float32BufferAttribute(base, 3));
    geometry.morphAttributes[name] = [0.25, -0.5].map((shift, n) => {
      const attr = new Float32BufferAttribute(base.map((v, i) => v + (i + 1) * shift), 3);
      attr.name = `expression${n}`;
      return attr;
    });
  }
  const original = structuredClone(Object.fromEntries(Object.entries(geometry.morphAttributes).map(([k, a]) => [k, a.map(x => Array.from(x.array))])));
  makeMorphsRelative(geometry);
  assert.equal(geometry.morphTargetsRelative, true);
  for (const weights of [[0.4, 0.6], [0.8, 0.7], [-0.3, 0.2]]) for (const name of ['position', 'normal']) {
    const base = geometry.attributes[name].array, targets = geometry.morphAttributes[name];
    assert.deepEqual(targets.map(t => t.name), ['expression0', 'expression1']);
    for (let i = 0; i < base.length; i++) {
      const absolute = base[i] * (1 - weights[0] - weights[1]) + original[name].reduce((s, t, k) => s + weights[k] * t[i], 0);
      const liveDisplacement = 0.17;
      const relative = base[i] + liveDisplacement + targets.reduce((s, t, k) => s + weights[k] * t.array[i], 0);
      assert.ok(Math.abs(relative - absolute - liveDisplacement) < 1e-6);
    }
  }
  const sameTargets = geometry.morphAttributes.position;
  makeMorphsRelative(geometry);
  assert.equal(geometry.morphAttributes.position, sameTargets);
});
