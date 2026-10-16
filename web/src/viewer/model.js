// Model loading + extraction of bind-pose data for the core baker.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { MMDLoader } from '@moeru/three-mmd';

// MMD units are ~8 cm; scale to metres so lights/camera/grid match VRM/glTF.
const MMD_SCALE = 0.08;

/**
 * @param {string|File|{entries: Array<{path:string, blob:Blob}>, name:string}} source
 *   URL, single file, or a set of files (dropped folder / unzipped archive) for
 *   formats with external textures (PMX).
 */
export async function loadModel(source, { keepMorphs = false } = {}) {
  if (source?.entries) return loadMMDEntries(source, { keepMorphs });
  const name = typeof source === 'string' ? source.split('/').pop() : source.name;
  const ext = name.split('.').pop().toLowerCase();
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  let root, vrm = null;
  if (ext === 'pmx' || ext === 'pmd') {
    const mmd = await new MMDLoader().loadAsync(url);
    return wrapMMD(mmd, name, keepMorphs);
  } else if (ext === 'fbx') {
    root = await new FBXLoader().loadAsync(url);
  } else {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    vrm = gltf.userData.vrm ?? null;
    root = vrm ? vrm.scene : gltf.scene;
    if (vrm && vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
  }
  root.updateMatrixWorld(true);
  return { root, vrm, name };
}

function wrapMMD(mmd, name, keepMorphs) {
  const mesh = mmd.mesh;
  if (!keepMorphs) {
    // PMX morphs come in as dense ABSOLUTE copies (~1 MB per morph per 84k
    // verts, x2 with normals on the GPU). They are facial and irrelevant to
    // the bust lab, so drop them unless asked (?keepMorphs=1).
    const g = mesh.geometry;
    g.morphAttributes = {};
    g.morphTargetsRelative = true;
    mesh.morphTargetDictionary = undefined;
    mesh.morphTargetInfluences = undefined;
    mesh.updateMorphTargets();
  }
  const root = new THREE.Group();
  root.name = name;
  root.add(mesh);
  root.scale.setScalar(MMD_SCALE);
  root.updateMatrixWorld(true);
  return { root, vrm: null, name, mmd };
}

// Folder / zip loading for PMX: map texture paths referenced inside the PMX
// (backslashes, case-insensitive, sometimes sloppy) to blob URLs.
const VROOT = 'mmd/';
const normPath = (p) => {
  let s = p;
  try { s = decodeURI(s); } catch { /* keep raw */ }
  const out = [];
  for (const seg of s.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/').normalize('NFC').toLowerCase();
};
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);

async function loadMMDEntries({ entries, name }, { keepMorphs }) {
  const byPath = new Map(), byName = new Map();
  let modelUrl = null, modelName = name;
  for (const { path, blob } of entries) {
    const key = normPath(path), url = URL.createObjectURL(blob);
    byPath.set(key, url);
    if (!byName.has(baseName(key))) byName.set(baseName(key), url);
    if (!modelUrl && /\.(pmx|pmd)$/.test(key)) {
      modelUrl = VROOT + key;
      modelName = baseName(path);
    }
  }
  if (!modelUrl) throw new Error('no .pmx/.pmd in the dropped files');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith(VROOT)) return url;
    const key = normPath(url.slice(VROOT.length));
    return byPath.get(key) ?? byName.get(baseName(key)) ?? url;
  });
  const mmd = await new MMDLoader(manager).loadAsync(modelUrl);
  return wrapMMD(mmd, modelName, keepMorphs);
}

export function entriesFromFileList(files) {
  return Array.from(files, (f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
}

// fflate returns non-UTF-8 zip names as latin1; re-decode as Shift_JIS (JP) or GBK (CN).
export function entriesFromZip(buffer, legacyEncoding = 'shift_jis') {
  const dec = new TextDecoder(legacyEncoding);
  const fix = (n) => (/^[\x00-\xff]*$/.test(n) && /[\x80-\xff]/.test(n) ? dec.decode(Uint8Array.from(n, (c) => c.charCodeAt(0))) : n);
  return Object.entries(unzipSync(new Uint8Array(buffer)))
    .filter(([n]) => !n.endsWith('/'))
    .map(([n, data]) => ({ path: fix(n), blob: new Blob([data]) }));
}

export const BONE_KEYS = ['hips', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];

// Bone-name heuristics for non-VRM rigs (Unity humanoid, Mixamo, Blender
// Rigify-ish, 3ds Max Biped "Bip001 ...", MMD Japanese names).
const SIDE = {
  left: /(^|[^a-z])l([^a-z]|$)|left|左|\.l$|_l$/i,
  right: /(^|[^a-z])r([^a-z]|$)|right|右|\.r$|_r$/i,
};
const PATTERNS = {
  hips: [/hips?$/i, /pelvis/i, /下半身/],
  chest: [/upper_?chest/i, /spine_?2$/i, /^(.*[^a-z])?chest$/i, /上半身2/, /spine_?1$/i, /上半身/],
  neck: [/neck$/i, /首$/],
  head: [/head$/i, /頭$/],
  upperArm: [/upper_?arm/i, /(left|right)arm$/i, /(^|[^a-z])arm$/i, /腕$/],
  lowerArm: [/fore_?arm/i, /lower_?arm/i, /elbow/i, /ひじ$/],
};

function findBone(bones, patterns, side) {
  for (const re of patterns) {
    const hit = bones.find((b) => {
      const n = b.name;
      if (!re.test(n)) return false;
      if (/twist|捩|end|_nub|top/i.test(n)) return false;
      if (side === 'left') return SIDE.left.test(n) && !/right|右/i.test(n);
      if (side === 'right') return SIDE.right.test(n) && !/left|左/i.test(n);
      return !(/left|right|左|右/i.test(n));
    });
    if (hit) return hit;
  }
  return null;
}

export function listBones(root) {
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  return bones;
}

export function resolveBones(root, vrm) {
  const out = {};
  if (vrm?.humanoid) {
    const g = (n) => vrm.humanoid.getRawBoneNode(n);
    out.hips = g('hips');
    out.chest = g('upperChest') ?? g('chest') ?? g('spine');
    out.neck = g('neck');
    out.head = g('head');
    out.leftUpperArm = g('leftUpperArm');
    out.rightUpperArm = g('rightUpperArm');
    out.leftLowerArm = g('leftLowerArm');
    out.rightLowerArm = g('rightLowerArm');
    return out;
  }
  const bones = listBones(root);
  out.hips = findBone(bones, PATTERNS.hips);
  out.chest = findBone(bones, PATTERNS.chest);
  out.neck = findBone(bones, PATTERNS.neck);
  out.head = findBone(bones, PATTERNS.head);
  out.leftUpperArm = findBone(bones, PATTERNS.upperArm, 'left');
  out.rightUpperArm = findBone(bones, PATTERNS.upperArm, 'right');
  out.leftLowerArm = findBone(bones, PATTERNS.lowerArm, 'left');
  out.rightLowerArm = findBone(bones, PATTERNS.lowerArm, 'right');
  return out;
}

export function collectMeshes(root) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });
  return meshes;
}

// Bind-space matrix of a bone = inverse of its inverse-bind matrix in any
// skeleton that contains it; falls back to the current world matrix.
export function boneBindMatrix(bone, meshes) {
  for (const m of meshes) {
    if (!m.isSkinnedMesh) continue;
    const i = m.skeleton.bones.indexOf(bone);
    if (i >= 0) return new THREE.Matrix4().copy(m.skeleton.boneInverses[i]).invert();
  }
  bone.updateWorldMatrix(true, false);
  return bone.matrixWorld.clone();
}

export function boneBindPosition(bone, meshes) {
  return new THREE.Vector3().setFromMatrixPosition(boneBindMatrix(bone, meshes)).toArray();
}

function attrToFloat32(attr) {
  if (!attr) return null;
  const n = attr.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

// Flat itemSize-strided copy (handles interleaved / normalized attributes).
function readComponents(attr) {
  if (!attr) return null;
  const k = attr.itemSize;
  const out = new Float32Array(attr.count * k);
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < k; c++) out[i * k + c] = attr.getComponent(i, c);
  return out;
}

function descendantsOf(bone) {
  const s = new Set();
  bone?.traverse((o) => s.add(o));
  return s;
}

// Everything the core baker needs from one mesh.
export function meshBindData(mesh, bones, maskOpts) {
  const g = mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const positions = attrToFloat32(g.attributes.position);
  const normals = attrToFloat32(g.attributes.normal);
  const bindMatrix = mesh.isSkinnedMesh ? mesh.bindMatrix.elements.slice() : mesh.matrixWorld.elements.slice();

  let excluded = null;
  if (mesh.isSkinnedMesh && g.attributes.skinIndex && (maskOpts.excludeArms || maskOpts.excludeHead)) {
    const ex = new Set();
    if (maskOpts.excludeArms) {
      for (const o of descendantsOf(bones.leftUpperArm)) ex.add(o);
      for (const o of descendantsOf(bones.rightUpperArm)) ex.add(o);
    }
    if (maskOpts.excludeHead) for (const o of descendantsOf(bones.head)) ex.add(o);
    excluded = new Set();
    mesh.skeleton.bones.forEach((b, i) => {
      if (ex.has(b)) excluded.add(i);
    });
  }
  return {
    positions,
    normals,
    bindMatrix,
    excluded,
    skinIndex: readComponents(g.attributes.skinIndex),
    skinWeight: readComponents(g.attributes.skinWeight),
    skinItemSize: g.attributes.skinIndex?.itemSize ?? 4,
    index: g.index ? g.index.array : null,
  };
}
