import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BustRig } from '../src/viewer/rig.js';
import { DEFAULT_PARAMS } from '../src/core/field.js';
import { deformPrepared } from '../src/core/morpho.js';

const bindPositions = [
  0.20, 0.02, 0.35, 0.28, 0.02, 0.35, 0.24, 0.12, 0.38,
  -0.20, 0.02, 0.35, -0.28, 0.02, 0.35, -0.24, 0.12, 0.38,
  0.20, 0.02, 0.40, 0.28, 0.02, 0.40, 0.24, 0.12, 0.43,
];
const profile = {
  materials: [{ material: 'skin surface', role: 'skin' }, { material: 'shirt', role: 'garment' }, { material: 'accessory', role: 'exclude' }],
};

function scene(bindMatrix = new THREE.Matrix4()) {
  const root = new THREE.Group(), bones = {};
  const coords = { chest: [0, 0, 0], hips: [0, -1, 0], neck: [0, 0.5, 0], leftUpperArm: [0.5, 0.3, 0], rightUpperArm: [-0.5, 0.3, 0] };
  for (const [key, position] of Object.entries(coords)) {
    const b = new THREE.Bone(); b.name = key; b.position.fromArray(position);
    bones[key] = b; root.add(b);
  }
  root.updateMatrixWorld(true);
  const inverse = bindMatrix.clone().invert();
  const local = [], nrm = [];
  const normalToLocal = new THREE.Matrix3().setFromMatrix4(bindMatrix).transpose();
  for (let i = 0; i < bindPositions.length; i += 3) {
    local.push(...new THREE.Vector3(...bindPositions.slice(i, i + 3)).applyMatrix4(inverse).toArray());
    nrm.push(...new THREE.Vector3(0, 0, 1).applyMatrix3(normalToLocal).normalize().toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(local, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(9 * 4), 4));
  const weights = new Float32Array(9 * 4); for (let v = 0; v < 9; v++) weights[v * 4] = 1;
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (let group = 0; group < 3; group++) g.addGroup(group * 3, 3, group);
  const materials = ['skin surface', 'shirt', 'accessory'].map((name) => new THREE.MeshBasicMaterial({ name }));
  const mesh = new THREE.SkinnedMesh(g, materials); mesh.name = 'test torso'; root.add(mesh);
  const skeleton = new THREE.Skeleton(Object.values(bones));
  mesh.bind(skeleton, bindMatrix);
  const rig = new BustRig({ root, bones, meshes: [mesh], profile });
  rig.prepare({ excludeArms: false, excludeHead: false });
  rig.bake(DEFAULT_PARAMS);
  return { rig, mesh };
}

const closeArray = (a, b, tolerance = 2e-7) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= tolerance, `index ${i}: ${a[i]} != ${b[i]}`);
};

test('profile roles exclude vertices from deformation and select skin/outer metric triangles', () => {
  const { rig, mesh } = scene();
  assert.deepEqual(Array.from(rig.entries[0].mask), [1, 1, 1, 1, 1, 1, 0, 0, 0]);
  for (const target of Object.values(rig.entries[0].result.targets)) assert.deepEqual(Array.from(target.dPos.slice(18)), Array(9).fill(0));
  assert.ok(rig.entries[0].result.targets.bust_lift_up.dPos.some((v) => Math.abs(v) > 0.001));
  assert.equal(rig.morpho.tris.length, 6);
  rig.prepareMetrics('skin'); assert.equal(rig.morpho.tris.length, 3);
  rig.prepareMetrics('all'); assert.equal(rig.morpho.tris.length, 6);
  const originalGroups = rig.materialGroups(mesh);
  rig.setHeatmap(true);
  assert.deepEqual(rig.materialGroups(mesh), originalGroups);
  assert.deepEqual(rig.exportBind().meshes[0].groups, originalGroups);
  rig.setHeatmap(false);
});

test('viewer metrics transform baked mesh-local deltas back to bind space under nonuniform transforms', () => {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(0.05, 0.02, -0.03), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.5, 0.3)), new THREE.Vector3(1.6, 0.9, 1.3));
  const a = scene().rig, b = scene(matrix).rig;
  closeArray(a.entries[0].posBind, b.entries[0].posBind);
  closeArray(a.morpho.B, b.morpho.B);
  assert.deepEqual(a.morpho.tris, b.morpho.tris);
  for (const target of a.field.targets) closeArray(a.morpho.D[target], b.morpho.D[target]);
  closeArray(deformPrepared(a.morpho, { bust_size_up_stylized: 0.8, bust_lift_up: 0.25 }), deformPrepared(b.morpho, { bust_size_up_stylized: 0.8, bust_lift_up: 0.25 }));
  const exported = b.exportBind().meshes[0];
  const normals = Buffer.from(exported.normals, 'base64');
  for (let v = 0; v < 9; v++) closeArray([normals.readFloatLE(v * 12), normals.readFloatLE(v * 12 + 4), normals.readFloatLE(v * 12 + 8)], [0, 0, 1]);
});
