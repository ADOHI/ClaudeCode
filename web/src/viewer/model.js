// Model loading + extraction of bind-pose data for the core baker.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export async function loadModel(source) {
  const name = typeof source === 'string' ? source.split('/').pop() : source.name;
  const ext = name.split('.').pop().toLowerCase();
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  let root, vrm = null;
  if (ext === 'fbx') {
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
