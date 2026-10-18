import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTissueProxy } from '../src/core/tissue-proxy.js';
import { DEFAULT_PARAMS, cloneParams, fromBody } from '../src/core/field.js';

const FRAME = { origin: [0, 0, 0], left: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], S: 1 };
const params = () => cloneParams(DEFAULT_PARAMS);
const close = (a, b, tol = 1e-10) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= tol, `index ${i}: ${a[i]} != ${b[i]}`);
};
const bind = (points, frame = FRAME) => new Float64Array(points.flatMap((p) => fromBody(frame, p.map((v) => v * frame.S))));

function capMeshes(p = params(), frame = FRAME, swell = 1) {
  return [1, -1].map((side) => {
    const pos = [], index = [], n = 20;
    const rx = p.anchor.x * 0.99, up = p.window.yUp * 0.72, down = p.window.yDown * 0.72;
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
      const qx = (2 * x / n - 1) * rx, qy = -down + y / n * (up + down);
      // Smooth, non-flat front with nonzero thickness throughout the grid.
      const z = p.anchor.z + p.depth * swell * (1 - 0.25 * (qx / rx) ** 2 - 0.2 * (qy / (qy > 0 ? up : down)) ** 2);
      pos.push(...fromBody(frame, [side * p.anchor.x + qx, p.anchor.y + qy, z].map((v) => v * frame.S)));
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      index.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
    return { pos: new Float64Array(pos), index: new Uint32Array(index) };
  });
}

function volumes(proxy) {
  const p = proxy.positions, out = [];
  for (let i = 0; i < proxy.tets.length; i += 4) {
    const [a, b, c, d] = proxy.tets.slice(i, i + 4).map((v) => v * 3);
    const u = [0, 1, 2].map((j) => p[b + j] - p[a + j]);
    const v = [0, 1, 2].map((j) => p[c + j] - p[a + j]);
    const w = [0, 1, 2].map((j) => p[d + j] - p[a + j]);
    out.push((u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])) / 6);
  }
  return out;
}

function front(proxy, side = 0) {
  const s = proxy.sides[side], x = s.cx, y = s.cy;
  const ix = (x - s.xMin) / (s.xMax - s.xMin) * (s.nx - 1), iy = (y - s.yMin) / (s.yMax - s.yMin) * (s.ny - 1);
  const x0 = Math.min(Math.floor(ix), s.nx - 2), y0 = Math.min(Math.floor(iy), s.ny - 2), u = ix - x0, v = iy - y0;
  const k = y0 * s.nx + x0;
  return (1 - v) * ((1 - u) * s.front[k] + u * s.front[k + 1]) + v * ((1 - u) * s.front[k + s.nx] + u * s.front[k + s.nx + 1]);
}

test('fitted cage has 240 nodes, 720 strictly positive tetrahedra, chest and rim attachments', () => {
  const proxy = buildTissueProxy({ frame: FRAME, params: params(), meshes: capMeshes() });
  assert.equal(proxy.positions.length, 240 * 3);
  assert.equal(proxy.tets.length, 720 * 4);
  assert.equal(proxy.info.sampledColumns, 60);
  assert.equal(proxy.info.fallbackColumns, 0);
  assert.equal(proxy.info.nearestColumns, 0);
  assert.ok(volumes(proxy).every((v) => v > 1e-9));
  assert.ok(proxy.fixed.some((v) => v === 0), 'interior tissue must be free');
  for (const s of proxy.sides) for (let z = 0; z < s.nz; z++) for (let y = 0; y < s.ny; y++) for (let x = 0; x < s.nx; x++) {
    const k = s.offset + (z * s.ny + y) * s.nx + x;
    if (z === 0 || x === 0 || y === 0 || x === s.nx - 1 || y === s.ny - 1) assert.equal(proxy.fixed[k], 1);
  }
});

test('identity transfer is exactly zero for all embedded and excluded positions', () => {
  const p = params(), proxy = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const points = bind([[p.anchor.x, p.anchor.y, front(proxy)], [-p.anchor.x, p.anchor.y - 0.05, p.anchor.z + 0.1], [0, 0, 0], [1, 1, 1]]);
  const embedding = proxy.embed(points);
  assert.ok(embedding.active.length >= 2);
  assert.deepEqual(proxy.displacement(embedding, proxy.positions), new Float64Array(points.length));
});

test('curvilinear trilinear transfer reproduces affine displacement in the interior', () => {
  const p = params(), proxy = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const points = [[p.anchor.x, p.anchor.y, p.anchor.z + 0.08], [p.anchor.x + 0.03, p.anchor.y + 0.04, p.anchor.z + 0.11], [-p.anchor.x + 0.02, p.anchor.y - 0.02, p.anchor.z + 0.12]];
  const affine = ([x, y, z]) => [0.1 + 0.2 * x + 0.3 * y - 0.4 * z, -0.1 + 0.3 * z - 0.2 * y, -0.15 * x + 0.04 * y];
  const live = proxy.positions.slice();
  for (let i = 0; i < live.length; i += 3) {
    const d = affine(Array.from(proxy.positions.slice(i, i + 3)));
    for (let j = 0; j < 3; j++) live[i + j] += d[j];
  }
  const e = proxy.embed(bind(points));
  assert.ok(e.mask.every((v) => v === 1));
  for (let i = 0; i < e.count; i++) close([0, 1, 2].map((j) => e.weights.slice(i * 8, i * 8 + 8).reduce((s, w, k) => s + w * proxy.positions[e.indices[i * 8 + k] * 3 + j], 0)), points[i]);
  close(proxy.displacement(e, live), points.flatMap(affine));
});

test('UV seam copies and near front clothing shell share the exact front displacement', () => {
  const p = params(), proxy = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const z = front(proxy), a = [p.anchor.x, p.anchor.y, z];
  const points = bind([a, a.slice(), [a[0], a[1], z + 0.02], [a[0], a[1], z + 0.07]]);
  const e = proxy.embed(points), live = proxy.positions.slice();
  for (let k = 0; k < live.length; k += 3) {
    const x = live[k], y = live[k + 1], z = live[k + 2];
    live[k] += y * z; live[k + 1] += x * z; live[k + 2] += z * z * 0.2;
  }
  const d = proxy.displacement(e, live);
  assert.deepEqual(d.slice(0, 3), d.slice(3, 6));
  assert.deepEqual(d.slice(0, 3), d.slice(6, 9));
  assert.deepEqual(d.slice(9, 12), new Float64Array(3));
  assert.ok(Math.abs(e.gaps[2] - 0.02) < 1e-12);
  assert.equal(e.mask[3], 0);
});

test('compact transfer vanishes at ellipse rim, posterior chest and caller exclusion mask', () => {
  const p = params(), proxy = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const s = proxy.sides[0], z = front(proxy);
  const points = bind([[s.xMax, s.cy, z], [s.cx, s.cy, s.wall], [s.cx, s.cy, s.wall - 0.01], [s.cx, s.cy, z], [s.cx, s.cy, z]]);
  const e = proxy.embed(points, new Float32Array([1, 1, 1, 0, 0.5]));
  close(e.mask, [0, 0, 0, 0, 0.5]);
  const live = proxy.positions.map((v) => v + 0.1);
  close(proxy.displacement(e, live), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.05, 0.05]);
});

test('rotating, translating and uniformly scaling the bind model preserves cage and transfer', () => {
  const p = params(), frame = { origin: [99, -13, 6], left: [0, 0, 1], up: [0, 1, 0], forward: [-1, 0, 0], S: 7 };
  const a = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const b = buildTissueProxy({ frame, params: p, meshes: capMeshes(p, frame) });
  close(a.positions, b.positions);
  assert.deepEqual(a.tets, b.tets);
  assert.deepEqual(a.fixed, b.fixed);
  const points = [[p.anchor.x + 0.02, p.anchor.y + 0.03, p.anchor.z + 0.1], [-p.anchor.x, p.anchor.y, front(a)]];
  const ae = a.embed(bind(points)), be = b.embed(bind(points, frame));
  close(ae.weights, be.weights);
  close(ae.mask, be.mask);
  close(a.displacement(ae, a.positions.map((v) => v * 1.03)), b.displacement(be, b.positions.map((v) => v * 1.03)));
});

test('rebuilding from statically swollen surface increases rest volume and fits the new envelope', () => {
  const p = params();
  const a = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p) });
  const b = buildTissueProxy({ frame: FRAME, params: p, meshes: capMeshes(p, FRAME, 1.4) });
  const total = (proxy) => volumes(proxy).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total(b) / total(a) - 1.4) < 1e-12);
  assert.ok(Math.abs((front(b) - p.anchor.z) / (front(a) - p.anchor.z) - 1.4) < 1e-12);
});

test('missing or excluded surface gives explicit fallback diagnostics and a valid cap volume', () => {
  const p = params(), meshes = capMeshes(p).map((m) => ({ ...m, mask: new Float32Array(m.pos.length / 3) }));
  const proxy = buildTissueProxy({ frame: FRAME, params: p, meshes });
  assert.equal(proxy.info.fallbackColumns, 60);
  assert.equal(proxy.info.sourceTriangles, 0);
  assert.equal(proxy.info.sourceVertices, 0);
  assert.ok(volumes(proxy).every((v) => v > 0));
  assert.ok(front(proxy) > p.anchor.z + 0.8 * p.depth);
});

test('invalid scale, cage divisions and mismatched transfer buffers are rejected', () => {
  assert.throws(() => buildTissueProxy({ frame: { ...FRAME, S: 0 }, params: params() }), /scale/);
  assert.throws(() => buildTissueProxy({ frame: FRAME, params: params(), divisions: [0, 3, 3] }), /divisions/);
  const proxy = buildTissueProxy({ frame: FRAME, params: params() });
  assert.throws(() => proxy.embed(new Float32Array(2)), /triples/);
  assert.throws(() => proxy.embed(new Float32Array(3), new Float32Array(2)), /mask count/);
  const e = proxy.embed(bind([[0.24, 0.05, 0.3]]));
  assert.throws(() => proxy.displacement(e, new Float64Array(3)), /position count/);
  assert.throws(() => proxy.displacement(e, proxy.positions, new Float64Array(6)), /output count/);
});
