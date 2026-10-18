import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateGolden, serializeGolden } from '../scripts/gen-golden.mjs';

function compare(actual, expected, path = '') {
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12, `${path}: ${actual} != ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), `${path} keys`);
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${path}/${key}`);
  } else assert.equal(actual, expected, path);
}

test('synthetic golden vectors match the checked-in porting specification within 1e-12', async () => {
  const expected = JSON.parse(await readFile(new URL('../../docs/golden.json', import.meta.url), 'utf8'));
  const actual = await generateGolden();
  assert.ok(actual.samples.length >= 200 && actual.samples.length < 250);
  assert.ok(actual.samples.some((s) => s.weight === 0));
  assert.ok(actual.samples.some((s) => s.weight > 0.9));
  assert.ok(actual.samples.some((s) => s.lateralLockFactor > 0 && s.lateralLockFactor < 1));
  compare(actual, expected);
});

test('golden generation is byte deterministic and serializes valid JSON', async () => {
  const first = serializeGolden(await generateGolden());
  const second = serializeGolden(await generateGolden());
  assert.equal(first, second);
  compare(JSON.parse(first), await generateGolden()); // JSON canonicalizes -0.
});
