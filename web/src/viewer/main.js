import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { loadModel, resolveBones, collectMeshes, entriesFromFileList, entriesFromZip } from './model.js';
import { BustRig } from './rig.js';
import { DEFAULT_PARAMS, cloneParams, buildBodyFrame } from '../core/field.js';
import { BustDynamics, DEFAULT_DYNAMICS, DEFAULT_POSE, poseCorrective, bustWeights, withRuntimeTargets, dynamicEnvelope, runtimeTargets } from '../core/runtime.js';
import { BANDS, scoreBands } from '../core/morpho.js';
import { parseParams, applyParams, parseProfile } from './config.js';
import { DemoMotion } from './motion.js';
import { TissueRig } from './tissue-rig.js';
import { sliderToWeights } from '../core/field.js';

const qs = new URLSearchParams(location.search);
const DEFAULT_MODEL = qs.get('model') ?? `${import.meta.env.BASE_URL}models/Seed-san.vrm`;

// ---------------------------------------------------------------- state
const state = {
  sliders: { size: 0, style: 0.5, lift: 0, spread: 0 },
  params: cloneParams(DEFAULT_PARAMS),
  dyn: { ...DEFAULT_DYNAMICS, mapping: 'dedicated', vskin: { ...DEFAULT_DYNAMICS.vskin } },
  tissue: { enabled: true, softness: 0.8, damping: 3.5, exaggeration: 1.3, iterations: 3 },
  pose: { ...DEFAULT_POSE },
  anim: { play: false, armDown: 65, bob: 0.035, bobHz: 1.8, armCycle: false },
  view: { heatmap: false, gizmo: false, hud: qs.get('hud') !== '0', autoFit: true, metrics: true, selection: 'outer' },
  preset: 'Hand tuned',
  profile: null,
};
const presets = new Map();
let activeEnvelope;

// ---------------------------------------------------------------- three
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d34);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 1.4, 2.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x445066, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(1.2, 2.5, 2.0);
scene.add(sun);
function setLighting(kind) {
  // MMD toon shading expects roughly MMD's default light (~0.6 directional + ambient)
  hemi.intensity = kind === 'mmd' ? 0.15 : 1.2;
  sun.intensity = kind === 'mmd' ? 1.5 : 2.2;
}
const grid = new THREE.GridHelper(4, 16, 0x555b66, 0x3a3e46);
scene.add(grid);

const gizmo = new THREE.Group();
gizmo.matrixAutoUpdate = false;
scene.add(gizmo);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- model
let model = null; // { root, vrm, name, rig, bones, restFrame, rest }
let tissue = null, tissueKey = null;
let report = null;
const dynamics = new BustDynamics(state.dyn);
const demoMotion = new DemoMotion();
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');

function worldPos(o) {
  return o.getWorldPosition(new THREE.Vector3()).toArray();
}

async function open(source) {
  releaseTissue();
  statusEl.textContent = 'loading…';
  if (model) {
    scene.remove(model.root);
    model = null;
  }
  const loaded = await loadModel(source, { keepMorphs: qs.get('keepMorphs') === '1' });
  scene.add(loaded.root);
  loaded.root.updateMatrixWorld(true);
  const bones = resolveBones(loaded.root, loaded.vrm);
  for (const [key, name] of Object.entries(state.profile?.bones ?? {})) {
    const bone = loaded.root.getObjectByName(name);
    if (!bone?.isBone) throw new Error(`Profile bone not found: ${key} = ${name}`);
    bones[key] = bone;
  }
  const meshes = collectMeshes(loaded.root);
  const rig = new BustRig({ ...loaded, meshes, bones, profile: state.profile });
  model = { ...loaded, rig, bones };
  setLighting(loaded.mmd ? 'mmd' : 'default');
  const missing = rig.missingBones();
  if (missing.length) {
    report = { error: `필수 본을 찾지 못함: ${missing.join(', ')}` };
    renderHud();
    statusEl.textContent = 'missing bones';
    return;
  }
  // World-space rest frame (for posing / camera); bind frame lives in rig.
  model.restFrame = buildBodyFrame({
    hips: worldPos(bones.hips),
    chest: worldPos(bones.chest),
    neck: worldPos(bones.neck),
    leftUpperArm: worldPos(bones.leftUpperArm),
    rightUpperArm: worldPos(bones.rightUpperArm),
  });
  model.chestBindInv = new THREE.Matrix4();
  setupPosing();
  demoMotion.reset();
  rig.prepare(state.params.mask);
  // Imported fields are already fitted to their source character. Never move
  // their anchors silently; only the hand-tuned baseline is auto-fitted.
  if (state.view.autoFit && state.preset === 'Hand tuned' && !state.profile?.region?.anchor) autoFit(false);
  applyProfileRegion();
  if (state.preset === 'Hand tuned') presets.set('Hand tuned', cloneParams(state.params));
  syncPresetOptions();
  Object.assign(dynamics.o, { restAxes: model.restFrame });
  dynamics.reset();
  rebake();
  setView('threeQuarter');
  statusEl.textContent = loaded.name;
}

function autoFit(doBake = true) {
  if (!model?.rig?.frame) return;
  const fit = model.rig.autoFit(state.params);
  model.fit = fit;
  if (fit) {
    Object.assign(state.params.anchor, {
      x: +fit.anchor.x.toFixed(3),
      y: +fit.anchor.y.toFixed(3),
      z: +fit.anchor.z.toFixed(3),
    });
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  if (doBake) rebake();
}

function rebake() {
  if (!model?.rig?.frame) return;
  releaseTissue();
  updateDynamics();
  dynamics.reset();
  activeEnvelope = dynamicEnvelope(state.params, runtimeTargets(state.params));
  // Extra dynamic shapes must exist before their signed weights are driven.
  const r = model.rig.bake(withRuntimeTargets(state.params));
  if (model.rig.metricSelection !== state.view.selection) model.rig.prepareMetrics(state.view.selection);
  report = { bake: r, validation: null };
  buildGizmo();
  renderHud();
}

function updateDynamics() {
  Object.assign(dynamics.o, state.dyn, { params: state.params, restAxes: model?.restFrame ?? null });
}

function releaseTissue() {
  tissue?.dispose();
  tissue = null; tissueKey = null;
}

function prepareRig() {
  releaseTissue();
  model.rig.prepare(state.params.mask);
}

function ensureTissue() {
  const key = JSON.stringify(state.sliders);
  if (tissue && tissueKey === key) return tissue;
  releaseTissue();
  tissue = new TissueRig(model.rig, sliderToWeights(state.sliders), model.restFrame, state.tissue);
  tissueKey = key;
  return tissue;
}

function applyProfileRegion() {
  const region = state.profile?.region;
  if (!region) return;
  applyParams(state.params, { ...state.params, ...region, anchor: { ...state.params.anchor, ...region.anchor }, window: { ...state.params.window, ...region.window } });
}

function syncPresetOptions() {
  activePreset = state.preset;
  presetController.options([...presets.keys()]);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

function selectPreset(name) {
  if (!presets.has(name)) throw new Error(`Unknown params preset: ${name}`);
  // Keep manual edits when switching back to this slot.
  presets.set(state.preset, cloneParams(state.params));
  applyParams(state.params, presets.get(name));
  state.preset = name;
  if (model?.rig?.frame) prepareRig();
  rebake();
  syncPresetOptions();
}

function importParams(input, name = 'Imported params') {
  const params = parseParams(input);
  // Replace an existing imported slot without overwriting it with the old UI state.
  presets.set(state.preset, cloneParams(state.params));
  presets.set(name, params);
  applyParams(state.params, params);
  state.preset = name;
  if (model?.rig?.frame) prepareRig();
  rebake();
  syncPresetOptions();
  return params;
}

async function importProfile(input) {
  const profile = parseProfile(input);
  // Resolve all overrides before mutating the active rig.
  const overrides = Object.fromEntries(Object.entries(profile.bones).map(([key, name]) => {
    const bone = model?.root.getObjectByName(name);
    if (model && !bone?.isBone) throw new Error(`Profile bone not found: ${key} = ${name}`);
    return [key, bone];
  }));
  state.profile = profile;
  applyProfileRegion();
  if (model) {
    // Restore the authored pose before recording new rest axes/bone rotations.
    if (model.rest) {
      model.pose.mover.position.copy(model.rest.moverPos);
      model.pose.lua.quaternion.copy(model.rest.lua);
      model.pose.rua.quaternion.copy(model.rest.rua);
      model.vrm?.update(0);
      model.root.updateMatrixWorld(true);
    }
    model.bones = { ...resolveBones(model.root, model.vrm), ...overrides };
    model.rig.bones = model.bones;
    model.rig.profile = profile;
    const missing = model.rig.missingBones();
    if (missing.length) throw new Error(`Profile missing bones: ${missing.join(', ')}`);
    model.restFrame = buildBodyFrame(Object.fromEntries(['hips', 'chest', 'neck', 'leftUpperArm', 'rightUpperArm'].map((k) => [k, worldPos(model.bones[k])])));
    setupPosing();
    demoMotion.reset();
    prepareRig();
    rebake();
  }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  return profile;
}

function runValidation() {
  if (!model?.rig?.field) return null;
  report.validation = model.rig.validate();
  renderHud();
  return report.validation;
}

// ---------------------------------------------------------------- posing
function setupPosing() {
  const { vrm, bones } = model;
  const node = (k) => {
    if (!vrm) return bones[k];
    // VRM.update copies normalized human bones to their raw counterparts.
    // A profile naming that same raw bone must still drive its normalized node.
    if (!state.profile?.bones[k] || vrm.humanoid.getRawBoneNode(k) === bones[k]) return vrm.humanoid.getNormalizedBoneNode(k) ?? bones[k];
    return bones[k];
  };
  // Body bob moves the lowest common ancestor of hips and chest: for MMD
  // rigs 下半身 (hips) is a sibling of 上半身, so moving it alone would tear
  // the body apart.
  const hips = node('hips'), chest = vrm ? node('hips') : bones.chest;
  const chain = new Set();
  for (let o = hips; o; o = o.parent) chain.add(o);
  let mover = chest;
  while (mover && !chain.has(mover)) mover = mover.parent;
  model.pose = {
    mover: mover ?? hips,
    lua: node('leftUpperArm'),
    rua: node('rightUpperArm'),
  };
  // Rest arm elevation (90 = T-pose, ~40-50 = A-pose MMD rigs); posing is
  // expressed as an absolute elevation so every rig ends up in the same pose.
  const f = model.restFrame;
  const elev = (a, b) => {
    if (!a || !b) return 90;
    const d = new THREE.Vector3(...worldPos(b)).sub(new THREE.Vector3(...worldPos(a))).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(-d.dot(new THREE.Vector3(...f.up)), -1, 1)));
  };
  model.rest = {
    chestWorld: bones.chest.getWorldQuaternion(new THREE.Quaternion()),
    moverPos: model.pose.mover.position.clone(),
    lua: model.pose.lua.quaternion.clone(),
    rua: model.pose.rua.quaternion.clone(),
    luaDeg: elev(bones.leftUpperArm, bones.leftLowerArm),
    ruaDeg: elev(bones.rightUpperArm, bones.rightLowerArm),
  };
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _v = new THREE.Vector3();
function rotateAboutWorldAxis(bone, restLocal, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  _q.setFromAxisAngle(_v.fromArray(axis), angle);
  bone.quaternion.copy(_pq).invert().multiply(_q).multiply(_pq).multiply(restLocal);
}

function applyPose(dt) {
  const f = model.restFrame;
  const motion = demoMotion.update(dt, state.anim);
  model.motion = motion;
  const down = motion.armDown;
  // `down` is measured from the T-pose: target elevation = 90 - down.
  const target = 90 - down;
  const aL = THREE.MathUtils.degToRad(model.rest.luaDeg - target);
  const aR = THREE.MathUtils.degToRad(model.rest.ruaDeg - target);
  rotateAboutWorldAxis(model.pose.lua, model.rest.lua, f.forward, -aL);
  rotateAboutWorldAxis(model.pose.rua, model.rest.rua, f.forward, aR);
  const hips = model.pose.mover;
  hips.position.copy(model.rest.moverPos);
  if (motion.bob !== 0) {
    const y = motion.bob * f.S;
    const up = _v.fromArray(f.up).multiplyScalar(y);
    hips.parent.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld).invert();
    hips.position.add(up.applyMatrix3(inv));
  }
}

// ---------------------------------------------------------------- gizmo
function buildGizmo() {
  gizmo.clear();
  const { rig } = model;
  const field = rig.field;
  const S = field.S;
  const f = field.frame;
  const mk = (color) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
  for (const side of field.sides) {
    const ax = side.xAxis;
    const W = state.params.window;
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const ry = s >= 0 ? W.yUp : W.yDown;
      const x = c * W.x * S, y = s * ry * S;
      pts.push(new THREE.Vector3(
        side.base[0] + ax[0] * x + f.up[0] * y,
        side.base[1] + ax[1] * x + f.up[1] * y,
        side.base[2] + ax[2] * x + f.up[2] * y,
      ));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mk(0x4ad7ff));
    line.renderOrder = 10;
    gizmo.add(line);
    const seg = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...side.base), new THREE.Vector3(...side.apex)]), mk(0xffd24a));
    seg.renderOrder = 10;
    gizmo.add(seg);
    for (const [p, col] of [[side.base, 0x4ad7ff], [side.apex, 0xffd24a]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.012 * S / 0.3, 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
      s.position.set(...p);
      s.renderOrder = 11;
      gizmo.add(s);
    }
  }
  model.chestBindInv.copy(bindMatrixOf(model.bones.chest)).invert();
  gizmo.visible = state.view.gizmo;
}

function bindMatrixOf(bone) {
  for (const m of model.rig.meshes) {
    if (!m.isSkinnedMesh) continue;
    const i = m.skeleton.bones.indexOf(bone);
    if (i >= 0) return new THREE.Matrix4().copy(m.skeleton.boneInverses[i]).invert();
  }
  return bone.matrixWorld.clone();
}

// ---------------------------------------------------------------- camera
function setView(name) {
  if (!model?.restFrame) return;
  const f = model.restFrame;
  const S = f.S;
  const v3 = (a) => new THREE.Vector3(...a);
  // Aim at the midpoint of the two apexes (bind space ~ world at rest).
  // Apexes live in bind space (e.g. MMD units); map them to world through
  // the chest bone (same transform the gizmo uses).
  const sides = model.rig?.field?.sides;
  let target;
  if (sides) {
    model.bones.chest.updateWorldMatrix(true, false);
    const bindToWorld = model.bones.chest.matrixWorld.clone().multiply(model.chestBindInv);
    target = v3(sides[0].apex).add(v3(sides[1].apex)).multiplyScalar(0.5).applyMatrix4(bindToWorld).addScaledVector(v3(f.up), 0.05 * S);
  } else {
    target = v3(f.origin).addScaledVector(v3(f.up), 0.1 * S).addScaledVector(v3(f.forward), 0.25 * S);
  }
  const dirs = {
    front: [v3(f.forward), 2.6],
    side: [v3(f.left).negate(), 2.6],
    threeQuarter: [v3(f.forward).multiplyScalar(0.8).addScaledVector(v3(f.left), -0.6).normalize(), 2.8],
    closeFront: [v3(f.forward), 2.8],
    closeSide: [v3(f.left).negate(), 3.0],
    full: [v3(f.forward).multiplyScalar(0.9).addScaledVector(v3(f.left), -0.35).normalize(), 7.5],
  };
  const [dir, dist] = dirs[name] ?? dirs.threeQuarter;
  const fullTarget = name === 'full' ? v3(f.origin).addScaledVector(v3(f.up), -1.2 * S) : target;
  camera.position.copy(fullTarget).addScaledVector(dir, dist * S).addScaledVector(v3(f.up), 0.15 * S);
  controls.target.copy(fullTarget);
  controls.update();
}

// ---------------------------------------------------------------- HUD
const fmt = (x, d = 3) => (x === undefined || x === null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function renderHud() {
  hud.classList.toggle('hidden', !state.view.hud);
  if (!state.view.hud) return;
  const L = [];
  if (!model) {
    hud.textContent = 'loading…';
    return;
  }
  L.push(`<b>${esc(model.name)}</b>`);
  L.push(`params: ${esc(state.preset)}${state.profile ? ` | profile: ${esc(state.profile.name)}` : ''}`);
  const b = model.bones;
  L.push(`bones: ${Object.entries(b).map(([k, v]) => `${k}=${v ? esc(v.name) : '<span class=bad>?</span>'}`).join(', ')}`);
  if (report?.error) L.push(`<span class=bad>${esc(report.error)}</span>`);
  if (report?.bake) {
    const r = report.bake;
    L.push(`bake: ${fmt(r.ms, 0)} ms, ${r.touched} verts on ${r.meshes} meshes, S=${fmt(model.rig.frame.S)}`);
    const fit = model.fit;
    L.push(fit
      ? `auto-fit: anchor ${fmt(fit.anchor.x)}, ${fmt(fit.anchor.y)}, ${fmt(fit.anchor.z)}  prominence ${fmt(fit.prominence)}${fit.usedPrior ? ' <span class=warn>(flat chest → anatomical prior)</span>' : ''}`
      : '<span class=warn>auto-fit failed, using manual anchor</span>');
    const per = model.rig.baked.map((e) => `${esc(e.mesh.name || '(mesh)')}:${e.result.touched}`);
    L.push(`  ${per.join('  ')}`);
  }
  if (state.view.metrics && model.rig.morpho) {
    const metrics = model.rig.measure(model.weights);
    const m = metrics.mean;
    L.push(`<b>morphometrics</b> (${state.view.selection}, bind shape)`);
    L.push(`upper/lower ${fmt(m.upperPoleFrac == null ? null : m.upperPoleFrac * 100, 1)} / ${fmt(m.upperPoleFrac == null ? null : (1 - m.upperPoleFrac) * 100, 1)}% | apex ${fmt(m.tiltDeg, 1)}°`);
    L.push(`projection/base ${fmt(m.projectionRatio)} | IMF ${fmt(m.imfY)} S | upper ${esc(m.upperShape ?? '-')}`);
    L.push(`natural distance ${fmt(scoreBands(m, BANDS.natural, { reference: model.rig.baseMetrics.mean }).distance, 2)} | anime hypothesis ${fmt(scoreBands(m, BANDS.anime, { reference: model.rig.baseMetrics.mean }).distance, 2)}`);
    if (!metrics.ok || m.flags.length) L.push(`<span class=warn>measurement: ${esc(m.flags.join(', ') || 'insufficient surface')}</span>`);
  }
  const v = report?.validation;
  if (v) {
    const f = v.field;
    L.push(`<b>validation</b> (${fmt(v.ms, 0)} ms)`);
    L.push(`field min det(F) = <span class=${f.minDet > 0.2 ? 'ok' : f.minDet > 0 ? 'warn' : 'bad'}>${fmt(f.minDet)}</span> @ ${f.minCombo}  (${f.samples} samples)`);
    L.push('volume change (mean / max |Δ|):');
    for (const [t, x] of Object.entries(f.volume)) L.push(`  ${t.padEnd(22)} ${fmt(x.meanChange * 100, 1).padStart(6)}%  ${fmt(x.maxAbsChange * 100, 1).padStart(6)}%`);
    if (v.mesh) {
      const m = v.mesh;
      const seamWorst = Math.max(...Object.values(m.seamMismatchRel));
      L.push(`seams: ${m.coincidentVertices} coincident verts, worst mismatch <span class=${seamWorst < 1e-3 ? 'ok' : 'warn'}>${fmt(seamWorst * 100, 3)}%</span> of max Δ`);
      L.push(`flipped triangles: <span class=${m.flippedTriangles === 0 ? 'ok' : 'bad'}>${m.flippedTriangles}</span> over all slider extremes (${m.movingTriangles} moving tris)${m.worstCombo ? ' worst ' + m.worstCombo : ''}`);
    }
    if (v.normals) {
      const n = v.normals;
      L.push(`normals (analytic F^-T vs geometric, ${n.target}): median ${fmt(n.median, 2)}°, p95 ${fmt(n.p95, 2)}°`);
    }
  }
  if (model.weights) {
    L.push(state.tissue.enabled ? `<b>3D tissue</b> body ${fmt(state.anim.bobHz, 1)} Hz | softness ${fmt(state.tissue.softness, 2)} | damping ${fmt(state.tissue.damping, 1)}`
      : `<b>legacy response</b> body ${fmt(state.anim.bobHz, 1)} Hz | spring ${fmt(state.dyn.frequency, 1)} Hz | damping ${fmt(state.dyn.damping, 2)}`);
    if (tissue) {
      const s = tissue.report();
      L.push(`volume max ${fmt(Math.max(...s.zoneVolumeErrors.map(Math.abs)) * 100, 2)}% | min det ${fmt(s.minDet)} | strain ${fmt(s.maxStrain * 100, 1)}%`);
      L.push(`${s.nodeCount} nodes / ${s.tetCount} tets | ${s.mappedVertices} mapped verts | ${fmt(s.ms, 1)} ms`);
      if (s.safetyClamps || s.normalGuards) L.push(`<span class=warn>limited steps ${s.safetyClamps} | normal guards ${s.normalGuards}</span>`);
      if (s.transferScale < 0.999) L.push(`<span class=warn>display deformation limited to ${fmt(s.transferScale * 100, 0)}%</span>`);
      if (s.resetCount) L.push(`motion resets ${s.resetCount} | last: ${esc(s.lastReset)}`);
    }
    L.push('<b>weights</b>');
    L.push(Object.entries(model.weights).filter(([, w]) => Math.abs(w) > 0.001).map(([k, w]) => `${esc(k)}=${fmt(w, 2)}`).join('  ') || '(all 0)');
  }
  if (model.poseInfo?.armDeg !== undefined) L.push(`arm elevation ${fmt(model.poseInfo.armDeg, 0)}°`);
  hud.innerHTML = L.join('\n');
}

// ---------------------------------------------------------------- GUI
const gui = new GUI({ title: 'Bust Morph Lab' });
presets.set('Hand tuned', cloneParams(state.params));
const fP = gui.addFolder('Params / character');
const presetController = fP.add(state, 'preset', [...presets.keys()]).name('params preset').onChange((name) => {
  // lil-gui writes state.preset first; restore the actual previous slot.
  state.preset = activePreset;
  selectPreset(name);
  activePreset = name;
});
let activePreset = state.preset;
fP.add({ loadParams: () => paramsInput.click() }, 'loadParams').name('load params JSON…');
fP.add({ loadProfile: () => profileInput.click() }, 'loadProfile').name('load character profile…');
const fS = gui.addFolder('Sliders (blend shapes)');
fS.add(state.sliders, 'size', -1, 1, 0.01).name('size −/+');
fS.add(state.sliders, 'style', 0, 1, 0.01).name('style natural→stylized');
fS.add(state.sliders, 'lift', -1, 1, 0.01).name('lift');
fS.add(state.sliders, 'spread', -1, 1, 0.01).name('spread in/out');

const fM = gui.addFolder('Test body motion');
fM.add(state.anim, 'play').name('play body motion');
fM.add(state.anim, 'armDown', -80, 85, 1).name('arm down (deg)');
fM.add(state.anim, 'armCycle').name('arm raise cycle');
fM.add(state.anim, 'bob', 0, 0.1, 0.001).name('body amplitude (S)');
fM.add(state.anim, 'bobHz', 0.5, 4, 0.1).name('body cycles (Hz)');
fM.add({ stop: () => { state.anim.play = false; gui.controllersRecursive().forEach(c => c.updateDisplay()); } }, 'stop').name('stop body / let settle');
fM.add({ baselineDemo }, 'baselineDemo').name('reset response demo');
const fA = gui.addFolder('Bust response');
const fT = gui.addFolder('3D soft tissue (research)');
fT.add(state.tissue, 'enabled').name('volumetric tissue').onChange(() => { releaseTissue(); dynamics.reset(); });
fT.add(state.tissue, 'softness', 0, 1, 0.01).name('softness');
fT.add(state.tissue, 'damping', 0.5, 10, 0.1).name('settling / damping');
fT.add(state.tissue, 'exaggeration', 0, 3, 0.01).name('motion exaggeration');
fT.add({ reset: () => tissue?.reset() }, 'reset').name('reset tissue motion');
fA.add(state.dyn, 'enabled').name('jiggle (bone-free)').onChange(updateDynamics);
for (const [k, name, lo, hi] of [['frequency', 'spring frequency (Hz)', 0.5, 6], ['damping', 'damping', 0.02, 1], ['gain', 'motion exaggeration', 0, 3]]) {
  const c = fA.add(state.dyn, k, lo, hi, 0.01).name(name).onChange(updateDynamics);
  c.domElement.title = k === 'frequency' ? '복원 진동수입니다. 몸의 애니메이션 속도와 별도 설정입니다.' : k === 'damping' ? '높을수록 잔진동이 빨리 가라앉습니다.' : '몸의 가속도에 대한 반응을 증폭합니다.';
}
fA.add(state.dyn.vskin, 'enabled').name('velocity shapes');
fA.add(state.pose, 'enabled').name('pose corrective');
fA.add(state.pose, 'lift', 0, 1, 0.01).name('arm-raise lift');
fA.add({ reset: () => dynamics.reset() }, 'reset').name('clear residual wobble');
fA.close();

function baselineDemo() {
  Object.assign(state.anim, { play: true, bob: 0.035, bobHz: 1.8, armDown: 65, armCycle: false });
  Object.assign(state.dyn, { enabled: true, frequency: 2.4, damping: 0.3, gain: 1 });
  Object.assign(state.tissue, { softness: 0.8, damping: 3.5, exaggeration: 1.3 });
  releaseTissue();
  state.dyn.vskin.enabled = false; // isolate the spring response from art distortions
  demoMotion.reset();
  updateDynamics();
  dynamics.reset();
  gui.controllersRecursive().forEach(c => c.updateDisplay());
}

const fR = gui.addFolder('Region / kernel (rebake)');
fR.add(state.params, 'kernel', ['kelvinlet', 'smooth']).onChange(rebake);
fR.add(state.params.anchor, 'x', 0.05, 0.5, 0.005).name('anchor x').onFinishChange(rebake);
fR.add(state.params.anchor, 'y', -0.5, 0.5, 0.005).name('anchor y').onFinishChange(rebake);
fR.add(state.params.anchor, 'z', -0.3, 0.6, 0.005).name('anchor z (base)').onFinishChange(rebake);
fR.add(state.params, 'depth', 0.05, 0.4, 0.005).onFinishChange(rebake);
for (const k of ['x', 'yUp', 'yDown', 'zFront', 'zBack', 'hardness', 'hardnessZ']) {
  fR.add(state.params.window, k, k.startsWith('hard') ? 0 : 0.005, k.startsWith('hard') ? 0.95 : 1.5, 0.005).name(`window ${k}`).onFinishChange(rebake);
}
fR.add(state.params.mask, 'excludeArms').onChange(() => { if (model) prepareRig(); rebake(); });
fR.add(state.params.mask, 'excludeHead').onChange(() => { if (model) prepareRig(); rebake(); });
fR.add({ autoFit: () => autoFit(true) }, 'autoFit').name('auto-fit anchors');
fR.close();

const fV = gui.addFolder('View / tools');
fV.add(state.view, 'heatmap').onChange((on) => model?.rig.setHeatmap(on));
fV.add(state.view, 'gizmo').onChange((on) => (gizmo.visible = on));
fV.add(state.view, 'hud').onChange(renderHud);
fV.add(state.view, 'metrics').name('morphometrics HUD');
fV.add(state.view, 'selection', ['outer', 'skin', 'all']).name('measure surface').onChange((s) => { if (model?.rig?.field) model.rig.prepareMetrics(s); renderHud(); });
const views = { front: () => setView('front'), side: () => setView('side'), threeQuarter: () => setView('threeQuarter'), closeFront: () => setView('closeFront') };
for (const k of Object.keys(views)) fV.add(views, k);
fV.add({ validate: runValidation }, 'validate').name('run validation');
fV.add({ exportParams }, 'exportParams').name('export params JSON');
fV.add({ load: () => fileInput.click() }, 'load').name('load model / zip…');
fV.add({ loadDir: () => dirInput.click() }, 'loadDir').name('load PMX folder…');

function exportParams() {
  const data = {
    format: 'bust-morph-params/1',
    note: 'Lengths in S = distance between upper-arm joints. Body frame: right-handed, forward = cross(left, up).',
    bones: Object.fromEntries(Object.entries(model?.bones ?? {}).map(([k, v]) => [k, v?.name ?? null])),
    params: state.params,
    sliders: state.sliders,
    dynamics: state.dyn,
    pose: state.pose,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'bust-morph-params.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

// ---------------------------------------------------------------- files
const fileInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.vrm,.glb,.gltf,.fbx,.pmx,.pmd,.zip' });
const paramsInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
paramsInput.onchange = async () => {
  const f = paramsInput.files[0];
  if (f) { try { importParams(await f.text(), f.name); activePreset = state.preset; } catch (e) { fail(e); } }
  paramsInput.value = '';
};
const profileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
profileInput.onchange = async () => {
  const f = profileInput.files[0];
  if (f) { try { await importProfile(await f.text()); } catch (e) { fail(e); } }
  profileInput.value = '';
};
fileInput.onchange = () => openFiles(fileInput.files).catch(fail);
const dirInput = Object.assign(document.createElement('input'), { type: 'file', webkitdirectory: true });
dirInput.onchange = () => openFiles(dirInput.files).catch(fail);
const drop = document.getElementById('drop');
addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
addEventListener('dragleave', () => drop.classList.remove('on'));
addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('on');
  // Dropped folders: walk directory entries so PMX textures come along.
  const items = [...(e.dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (items.some((it) => it.isDirectory)) {
    const files = [];
    await Promise.all(items.map((it) => walkEntry(it, '', files)));
    openEntries(files, items[0].name).catch(fail);
  } else {
    openFiles(e.dataTransfer.files).catch(fail);
  }
});

function walkEntry(entry, prefix, out) {
  if (entry.isFile) return new Promise((res) => entry.file((f) => { out.push({ path: prefix + f.name, blob: f }); res(); }, res));
  const reader = entry.createReader();
  return new Promise((res) => {
    const all = [];
    const next = () => reader.readEntries(async (batch) => {
      if (!batch.length) {
        await Promise.all(all.map((c) => walkEntry(c, `${prefix}${entry.name}/`, out)));
        res();
      } else { all.push(...batch); next(); }
    }, res);
    next();
  });
}

async function openFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  if (files.length === 1 && /\.json$/i.test(files[0].name)) {
    const data = JSON.parse(await files[0].text());
    if (data.format === 'bust-character-profile/1') return importProfile(data);
    importParams(data, files[0].name); activePreset = state.preset;
    return;
  }
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  if (zip) return openEntries(entriesFromZip(await zip.arrayBuffer(), qs.get('zipEncoding') ?? 'shift_jis'), zip.name);
  if (files.length > 1 || files.some((f) => /\.(pmx|pmd)$/i.test(f.name))) return openEntries(entriesFromFileList(files), files[0].name);
  return open(files[0]);
}

function openEntries(entries, name) {
  return open({ entries, name });
}

function fail(err) {
  console.error(err);
  statusEl.textContent = `error: ${err.message}`;
  report = { error: String(err.message ?? err) };
  renderHud();
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let hudTimer = 0;
function frame(dt, render = true) {
  if (model?.rig?.field) {
    applyPose(dt);
    model.vrm?.update(dt);
    model.root.updateMatrixWorld(true);
    const f = model.restFrame;
    const chestRotation = model.bones.chest.getWorldQuaternion(new THREE.Quaternion()).multiply(model.rest.chestWorld.clone().invert());
    const rotated = (a) => new THREE.Vector3(...a).applyQuaternion(chestRotation).toArray();
    const chestPose = { pos: worldPos(model.bones.chest), left: rotated(f.left), up: rotated(f.up), forward: rotated(f.forward), S: f.S };
    const dyn = state.tissue.enabled ? null : dynamics.update(dt, chestPose);
    if (!state.tissue.enabled && tissue) releaseTissue();
    const b = model.bones;
    const pc = b.leftLowerArm && b.rightLowerArm
      ? poseCorrective(worldPos(b.leftUpperArm), worldPos(b.leftLowerArm), worldPos(b.rightUpperArm), worldPos(b.rightLowerArm), chestPose.up, state.pose)
      : { lift: 0, spread: 0 };
    model.poseInfo = pc;
    model.weights = bustWeights({ sliders: state.sliders, extras: dyn ? [dyn, pc] : [pc], envelope: activeEnvelope });
    model.dynamicsStatus = dyn?.status ?? 'volumetric';
    model.rig.setWeights(model.weights);
    if (state.tissue.enabled) ensureTissue().update(dt, chestPose, model.weights, state.tissue);
    // gizmo follows the chest
    gizmo.matrix.copy(model.bones.chest.matrixWorld).multiply(model.chestBindInv);
  }
  controls.update();
  if (render) renderer.render(scene, camera);
  hudTimer += dt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    renderHud();
  }
}
renderer.setAnimationLoop(() => frame(clock.getDelta()));

// ---------------------------------------------------------------- test hook
window.__bust = {
  state,
  open: (url) => open(url),
  setSliders: (s) => Object.assign(state.sliders, s),
  setParams: (fn) => { fn(state.params); rebake(); },
  importParams: (p, name) => { const result = importParams(p, name); activePreset = state.preset; return result; },
  selectPreset: (name) => { selectPreset(name); activePreset = state.preset; },
  importProfile,
  presets: () => [...presets.keys()],
  setAnim: (a) => Object.assign(state.anim, a),
  resetMotion: () => { demoMotion.reset(); dynamics.reset(); tissue?.reset(); },
  baselineDemo,
  setDyn: (d) => { Object.assign(state.dyn, d); updateDynamics(); dynamics.reset(); },
  setTissue: (t) => { Object.assign(state.tissue, t); if (t.enabled !== undefined) releaseTissue(); },
  tissueReport: () => tissue?.report(),
  setView,
  setHeatmap: (on) => { state.view.heatmap = on; model?.rig.setHeatmap(on); },
  setGizmo: (on) => { state.view.gizmo = on; gizmo.visible = on; },
  setHud: (on) => { state.view.hud = on; renderHud(); },
  validate: () => runValidation(),
  exportBind: () => model?.rig?.exportBind(),
  report: () => report,
  metrics: () => model?.rig?.morpho ? model.rig.measure(model.weights) : null,
  weights: () => model?.weights,
  runtime: () => ({ status: model?.dynamicsStatus, targets: model?.rig?.field?.targets, armDeg: model?.poseInfo?.armDeg, bodyBob: model?.motion?.bob }),
  // deterministic stepping for screenshots
  step: (dt, n = 1, render = true) => { for (let i = 0; i < n; i++) frame(dt, render && i === n - 1); },
  pause: () => renderer.setAnimationLoop(null),
  ready: false,
};

open(DEFAULT_MODEL)
  .then(() => { window.__bust.ready = true; })
  .catch(fail);
