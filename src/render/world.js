// 엔티티 → InstancedMesh. (레이어그룹 × 형상 × 재질)별로 묶어 토글은 mesh.visible로, 강조는 인스턴스 색으로.
import * as THREE from 'three';

const GROUP_OF = {
  building: 'building', roof: 'building', facade: 'building',
  prop: 'prop', tree: 'prop', wall: 'prop', terrain: 'prop', poi: 'prop',
  rail: 'rail', landmark: 'landmark', gameplay: 'gameplay', secret: 'secret', crumb: 'crumb',
};
export const LAYER_GROUPS = ['building', 'prop', 'rail', 'landmark', 'gameplay', 'secret', 'crumb'];

function baseGeo(g) {
  g.translate(0, 0.5, 0);
  return g;
}

function gableGeo() {
  // 박공 지붕: z 단면이 삼각형, 용마루가 x축
  const g = new THREE.BufferGeometry();
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // 앞 경사
    -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, 0.5, 0, 0.5, // 뒤 경사
    -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5, // 박공벽
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0,
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rampGeo() {
  // 경사로: x=-0.5에서 높이 0, x=+0.5에서 높이 1
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0.5, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

export function makeGeometries() {
  const gable = gableGeo();
  return {
    box: baseGeo(new THREE.BoxGeometry(1, 1, 1)),
    cyl: baseGeo(new THREE.CylinderGeometry(0.5, 0.5, 1, 14)),
    cone: baseGeo(new THREE.ConeGeometry(0.5, 1, 14)),
    cone4: baseGeo(new THREE.ConeGeometry(0.5, 1, 4)),
    cone6: baseGeo(new THREE.ConeGeometry(0.5, 1, 6)),
    sphere: baseGeo(new THREE.IcosahedronGeometry(0.5, 1)),
    oct: baseGeo(new THREE.OctahedronGeometry(0.5)),
    torus: new THREE.TorusGeometry(0.5, 0.035, 6, 40),
    gable,
    ramp: rampGeo(),
  };
}

// 건물 재질: 인스턴스 스케일로 로컬 미터 좌표를 복원해 층 띠/창문 격자를 그린다
function buildingMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = position * sc;
        vNrm = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vNrm;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vNrm.y) < 0.5) {
          float along = abs(vNrm.x) > 0.5 ? vLocal.z : vLocal.x;
          float fy = fract(vLocal.y / 3.2);
          float fx = fract(along / 2.6 + 0.5);
          float win = step(0.38, fy) * step(fy, 0.82) * step(0.18, fx) * step(fx, 0.82);
          float ground = step(vLocal.y, 3.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.62, 0.78), win * (1.0 - ground * 0.35));
          diffuseColor.rgb *= 1.0 - 0.10 * (1.0 - step(0.06, fy));
        } else {
          diffuseColor.rgb *= 0.92;
        }`);
  };
  m.customProgramCacheKey = () => 'bld-windows';
  return m;
}

export function makeMaterials() {
  return {
    bld: buildingMaterial(),
    std: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    glass: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
  };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

export function entityMatrix(e, out = _m) {
  let shape = e.shape;
  _p.set(e.x, e.y, e.z);
  // 엔진 규약: rot은 로컬 +x(u)축의 월드 각도(x→z). three의 Y회전은 반대 방향이라 부호 반전.
  _e.set(e.rx || 0, -(e.rot || 0), e.rz || 0, 'YXZ');
  if (shape === 'torus') {
    _s.set(e.w, e.h, e.w);
    _p.y = e.y;
  } else {
    _s.set(e.w, e.h, e.d);
  }
  _q.setFromEuler(_e);
  return out.compose(_p, _q, _s);
}

export function shapeKey(e) {
  if (e.shape === 'cone' && e.sides === 4) return 'cone4';
  if (e.shape === 'cone' && e.sides === 6) return 'cone6';
  return e.shape;
}

/** ctx.entities → 그룹별 InstancedMesh */
export function buildWorldMeshes(ctx, geos, mats) {
  const buckets = new Map();
  for (const e of ctx.entities) {
    if (e.deleted) continue;
    const group = GROUP_OF[e.cat] || 'prop';
    const key = `${group}|${shapeKey(e)}|${e.mat || 'std'}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { group, shape: shapeKey(e), mat: e.mat || 'std', ents: [] }));
    b.ents.push(e);
  }
  const root = new THREE.Group();
  const meshes = [];
  const groups = {};
  for (const b of buckets.values()) {
    const geo = geos[b.shape] || geos.box;
    const mat = mats[b.mat] || mats.std;
    const mesh = new THREE.InstancedMesh(geo, mat, b.ents.length);
    const ids = new Int32Array(b.ents.length);
    b.ents.forEach((e, i) => {
      mesh.setMatrixAt(i, entityMatrix(e));
      mesh.setColorAt(i, _c.set(Array.isArray(e.color) ? e.color[0] : e.color || '#cccccc'));
      ids[i] = e.id;
      e._mesh = meshes.length;
      e._inst = i;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData = { ids, group: b.group, shape: b.shape, mat: b.mat };
    const castable = b.mat !== 'glow' && b.mat !== 'glass' && b.group !== 'crumb';
    mesh.castShadow = castable && (b.group === 'building' || b.group === 'landmark' || b.group === 'rail' || b.group === 'prop');
    mesh.receiveShadow = b.mat !== 'glow';
    mesh.frustumCulled = false;
    meshes.push(mesh);
    (groups[b.group] = groups[b.group] || []).push(mesh);
    root.add(mesh);
  }
  return { root, meshes, groups };
}

/** 규칙 강조: 해당 규칙 외 인스턴스는 회색으로 */
export function highlightRule(ctx, world, rule) {
  for (const mesh of world.meshes) {
    const ids = mesh.userData.ids;
    for (let i = 0; i < ids.length; i++) {
      const e = ctx.entities[ids[i]];
      const base = e.color || '#cccccc';
      if (!rule || e.rule === rule) _c.set(base);
      else {
        _c.set(base);
        const l = (_c.r + _c.g + _c.b) / 3;
        _c.setRGB(l * 0.35 + 0.45, l * 0.35 + 0.45, l * 0.35 + 0.47);
      }
      mesh.setColorAt(i, _c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export function hideEntity(world, e) {
  if (e._mesh === undefined) return;
  const mesh = world.meshes[e._mesh];
  mesh.setMatrixAt(e._inst, ZERO);
  mesh.instanceMatrix.needsUpdate = true;
}
export function showEntity(world, e) {
  if (e._mesh === undefined) return;
  const mesh = world.meshes[e._mesh];
  mesh.setMatrixAt(e._inst, entityMatrix(e));
  mesh.instanceMatrix.needsUpdate = true;
}
