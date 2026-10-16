// 도시 골격(A-skeleton) 자가 검사: 레거시 동일성 · 골격 게이트 · 스윕 · 결정론 · 디버그 PNG.
// 사용: node tools/check-plan.mjs [--sweep] [--png out.png] [--seed lumina] [--no-parity]
import { createContext, STAGES, generateSync } from '../src/core/generator.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

// ---- devpipe (plan_md §5, verbatim) ----
const NAMES = ['terrain','districts','history','structure','roads','streets','blocks','seams','city','analysis','influence','style','signatures','archurban','campus','park','rail','props','intent','metrics'];
const M = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await import(`../src/core/${n}.js`).catch((e) => { console.warn(`[devpipe] ${n}.js unavailable: ${e.message}`); return {}; })])));
const call = (n, f, c) => (M[n][f] ? M[n][f](c) : undefined);
export function devGenerate(seed, params = {}) {
  const P = { plan: true, arch: 1, wow: 1, ...params };
  if (STAGES.some((s) => s[0] === 'plan')) return generateSync(seed, null, P);   // lead has wired generator.js
  const c = createContext(seed, P); c.plan = null; c.history = null;
  const AR = P.arch !== 0, T = (k, fn) => { const t = performance.now(); fn(); c.timings[k] = performance.now() - t; };
  const t0 = performance.now();
  T('terrain', () => call('terrain','genTerrain',c));
  T('districts', () => call('districts','genDistricts',c));
  T('history', () => { if (P.plan) call('history','genHistory',c); });
  T('plan', () => { if (P.plan) call('structure','genPlan',c); });
  T('roads', () => { call('roads','genRoads',c); call('roads','rasterizeRoads',c); call('roads','computeNodes',c); if (c.plan) call('streets','planStreets',c); });
  T('blocks', () => { call('blocks','extractBlocks',c); call('blocks','genAlleys',c); call('city','markSpecialBlocks',c); });
  T('lots', () => { call('blocks','genLots',c); if (c.plan) { call('seams','annotateLots',c); call('streets','markThresholds',c); } });
  T('flow0', () => { if (c.plan && M.structure.buildOD) call('structure','buildOD',c); else call('city','buildHubs',c);
    call('analysis','roadFlow',c); if (c.plan) call('structure','accessFields',c); call('city','chooseLandmarkSites',c);
    if (c.plan || AR) call('influence','computeFactionField',c);
    if (AR) { call('style','prepareArchitecture',c); call('signatures','chooseSignatureSites',c); call('style','finalizeArchitecture',c); } });
  T('buildings', () => { call('city','genCenter',c);
    if ((c.plan || AR) && M.city.genCityBuildingsPlan) call('city','genCityBuildingsPlan',c); else call('city','genCityBuildings',c);
    if (AR) call('signatures','buildSignatures',c); if (c.plan) call('city','genSquares',c);
    call('city','genContainerYard',c); call('city','genHarborFeatures',c); if (AR) call('archurban','genRowArcades',c); });
  T('campus', () => { call('campus','genCampuses',c); if (AR) call('signatures','buildCampusSignatures',c); });
  T('park', () => call('park','genPark',c));
  T('rail', () => call('rail','genRail',c));
  T('props', () => { if (c.plan || AR) call('archurban','genArchUrban',c); call('props','genProps',c); });
  T('analysis', () => call('analysis','fullAnalysis',c));
  T('intent', () => call('intent','genIntent',c));
  T('metrics', () => call('metrics','computeMetrics',c));
  c.timings.total = performance.now() - t0;
  return c;
}

/** A 패키지 단계만 (terrain → flow0의 A 부분). 다른 패키지 작업 중에도 골격을 검사할 수 있게. */
export function devGenerateA(seed, params = {}) {
  const P = { plan: true, arch: 0, wow: 1, ...params };
  const c = createContext(seed, P); c.plan = null; c.history = null;
  const T = (k, fn) => { const t = performance.now(); fn(); c.timings[k] = performance.now() - t; };
  const t0 = performance.now();
  T('terrain', () => call('terrain', 'genTerrain', c));
  T('districts', () => call('districts', 'genDistricts', c));
  T('history', () => { if (P.plan) call('history', 'genHistory', c); });
  T('plan', () => { if (P.plan) call('structure', 'genPlan', c); });
  T('roads', () => { call('roads', 'genRoads', c); call('roads', 'rasterizeRoads', c); call('roads', 'computeNodes', c); if (c.plan) call('streets', 'planStreets', c); });
  T('blocks', () => { call('blocks', 'extractBlocks', c); call('blocks', 'genAlleys', c); call('city', 'markSpecialBlocks', c); });
  T('lots', () => { call('blocks', 'genLots', c); if (c.plan) { call('seams', 'annotateLots', c); call('streets', 'markThresholds', c); } });
  T('flowA', () => { if (c.plan && M.structure.buildOD) call('structure', 'buildOD', c); else call('city', 'buildHubs', c);
    call('analysis', 'roadFlow', c); if (c.plan) call('structure', 'accessFields', c); });
  c.timings.total = performance.now() - t0;
  return c;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
let failures = 0;
const results = [];
function gate(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}

// ---- 레거시 기준 (e1661f2) ----
function entitySha(ctx) {
  const h = createHash('sha1');
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v === undefined ? null : v);
  const F = ['shape', 'kind', 'cat', 'x', 'y', 'z', 'w', 'h', 'd', 'rot', 'rx', 'rz', 'color', 'solid', 'rule'];
  for (const e of ctx.entities) {
    if (e.deleted) continue;
    h.update(JSON.stringify(F.map((f) => r(e[f]))));
    h.update('\n');
  }
  return h.digest('hex');
}
function hashArr(a) {
  if (!a) return 'none';
  const h = createHash('sha1');
  h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex').slice(0, 16);
}
/** A가 만드는 레이어(지형·구역·도로·블록·필지·도로 흐름)의 지문 */
function aFingerprint(c) {
  const lots = (c.lots || []).map((l) => [l.x, l.z, l.w, l.d, l.rot, l.front, l.frontRank, l.corner, l.interior].map((v) => (typeof v === 'number' ? Math.round(v * 1000) : v)));
  const blocks = (c.blocks || []).map((b) => [Math.round(b.cx * 1000), Math.round(b.cz * 1000), b.area, b.district]);
  return {
    terrain: hashArr(c.terrain && c.terrain.data), district: hashArr(c.district && c.district.data), zone: hashArr(c.zone && c.zone.data),
    road: hashArr(c.road && c.road.data), roadLines: (c.roadLines || []).length,
    roadPts: createHash('sha1').update(JSON.stringify((c.roadLines || []).map((l) => l.pts.map((p) => [Math.round(p.x * 1000), Math.round(p.z * 1000)])))).digest('hex').slice(0, 16),
    nodes: (c.nodes || []).length, gates: JSON.stringify((c.gates || []).map((g) => [g.x, g.z, g.dir])),
    blocks: createHash('sha1').update(JSON.stringify(blocks)).digest('hex').slice(0, 16),
    lots: createHash('sha1').update(JSON.stringify(lots)).digest('hex').slice(0, 16),
    roadFlow: hashArr(c.roadFlow && c.roadFlow.data), hubs: (c.hubs || []).length,
    names: (c.districts || []).map((d) => d.name).join(','),
  };
}
let legacyMod = null;
async function legacyGenerator() {
  if (legacyMod) return legacyMod;
  const dir = join(tmpdir(), 'academy-city-legacy-e1661f2');
  if (!existsSync(join(dir, 'src/core/generator.js'))) {
    mkdirSync(dir, { recursive: true });
    execSync(`git -C "${ROOT}" archive e1661f2 src | tar -x -C "${dir}"`);
  }
  legacyMod = await import(pathToFileURL(join(dir, 'src/core/generator.js')).href);
  return legacyMod;
}
async function legacyRef(seed) {
  const bf = join(HERE, 'baseline', `${seed}.json`);
  const L = await legacyGenerator();
  const ref = L.generateSync(seed, null, {});
  const out = { metrics: JSON.parse(JSON.stringify(ref.metrics)), sha: entitySha(ref), fp: aFingerprint(ref), src: 'git e1661f2' };
  if (existsSync(bf)) {
    try {
      const b = JSON.parse(readFileSync(bf, 'utf8'));
      if (b.metrics) { out.baseMetrics = b.metrics; out.src += ' + ' + bf.replace(ROOT + '/', ''); }
      const sha = b.sha1 || b.sha || b.entitySha1 || b.entitiesSha1 || b.entitySha;
      if (sha) out.baseSha = sha;
    } catch { /* 형식이 다르면 무시 */ }
  }
  return out;
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function parity(seeds) {
  console.log('\n[1] 레거시 동일성 {plan:false, arch:0}');
  for (const seed of seeds) {
    const ref = await legacyRef(seed);
    let c, err = null;
    try { c = devGenerate(seed, { plan: false, arch: 0 }); } catch (e) { err = e; }
    if (err) {
      gate(`${seed}: devGenerate runs`, false, err.stack.split('\n').slice(0, 3).join(' | '));
      // 다른 패키지가 작업 중이면 A 레이어만이라도 비교
      const a = devGenerateA(seed, { plan: false, arch: 0 });
      const fp = aFingerprint(a), rf = ref.fp;
      const diff = Object.keys(rf).filter((k) => k !== 'hubs' && fp[k] !== rf[k]);
      gate(`${seed}: A-layer fingerprint`, diff.length === 0, diff.length ? diff.join(',') : 'terrain/district/zone/road/blocks/lots/roadFlow identical');
      continue;
    }
    const keys = Object.keys(ref.metrics);
    const bad = keys.filter((k) => !deepEq(ref.metrics[k], c.metrics ? c.metrics[k] : undefined));
    gate(`${seed}: legacy metrics deep-equal (${keys.length} keys) [${ref.src}]`, bad.length === 0, bad.length ? bad.slice(0, 6).map((k) => `${k}: ${JSON.stringify(ref.metrics[k]).slice(0, 60)} → ${JSON.stringify(c.metrics && c.metrics[k]).slice(0, 60)}`).join(' ; ') : `entities ${c.metrics.entities}`);
    if (ref.baseMetrics) {
      const bk = Object.keys(ref.baseMetrics).filter((k) => typeof ref.baseMetrics[k] !== 'undefined' && k in ref.metrics);
      const bb = bk.filter((k) => !deepEq(ref.baseMetrics[k], c.metrics[k]));
      gate(`${seed}: tools/baseline metrics`, bb.length === 0, bb.slice(0, 4).join(','));
    }
    const sha = entitySha(c);
    gate(`${seed}: live-entity SHA-1`, sha === ref.sha, sha.slice(0, 12));
    if (seed === 'lumina') gate('lumina: 12722 live entities', c.metrics.entities === 12722, String(c.metrics.entities));
    const fp = aFingerprint(c), rf = ref.fp;
    const diff = Object.keys(rf).filter((k) => fp[k] !== rf[k]);
    gate(`${seed}: A-layer fingerprint`, diff.length === 0, diff.length ? diff.join(',') : 'identical');
  }
}

// ---- 2) 계획 모드 게이트 (lumina, arch:0) ----
const within = (v, a, b) => typeof v === 'number' && v >= a && v <= b;
function planGates(seed) {
  console.log(`\n[2] 골격 게이트 ${seed} {plan:true, arch:0}`);
  let c, full = true;
  try { c = devGenerate(seed, { plan: true, arch: 0 }); } catch (e) {
    console.log(`  (full pipeline threw: ${e.message.split('\n')[0]} — A 단계만 검사)`);
    full = false;
    c = devGenerateA(seed, { plan: true, arch: 0 });
  }
  const p = c.plan;
  gate('plan built', !!p, p ? '' : 'ctx.plan is null');
  if (!p) return c;
  const st = p.stats || {};
  console.log('  plan.stats:', JSON.stringify(st));
  gate('ringClosed', st.ringClosed === true);
  gate('ringCoverageDeg 330–450', within(st.ringCoverageDeg, 330, 450), st.ringCoverageDeg);
  gate('ringLen 1300–2000', within(st.ringLen, 1300, 2000), st.ringLen);
  gate('radials 4–7, all terminated', within(st.radials, 4, 7) && st.radialsTerminated === st.radials, `${st.radials}/${st.radialsTerminated}`);
  gate('ring stations 5–8 + central', within(st.stations, 5, 8) && st.central === true, `${st.stations} + ${st.central}`);
  const gsw = st.gateStationWalk || {};
  const gv = Object.values(gsw);
  gate('gateStationWalk all in [80,260]', gv.length >= 4 && gv.every((v) => within(v, 80, 260)), JSON.stringify(gsw));
  gate('gakuenCoverage = 1', st.gakuenCoverage === 1, st.gakuenCoverage);
  gate('namedStreets 5–10', within(st.namedStreets, 5, 10), st.namedStreets);
  gate('namedStreetKm ≥ 1.0', st.namedStreetKm >= 1.0, st.namedStreetKm);
  gate('mainShare 0.15–0.27', within(st.mainShare, 0.15, 0.27), st.mainShare);
  gate('thresholds 8–24', within(st.thresholds, 8, 24), st.thresholds);
  gate('relations 10–24', within(st.relations, 10, 24), st.relations);
  gate('relationRealized ≥ 0.6', st.relationRealized >= 0.6, st.relationRealized);
  gate('oldRoadKm ≥ 0.3', st.oldRoadKm >= 0.3, st.oldRoadKm);
  gate('tJunctions ≥ 3', st.tJunctions >= 3, st.tJunctions);
  gate('harborMouth ≤ 230', st.harborMouth !== null && st.harborMouth <= 230, st.harborMouth);
  gate('dormTownMax ≤ 480', st.dormTownMax !== null && st.dormTownMax <= 480, st.dormTownMax);
  gate('lots ≥ 760', c.lots.length >= 760, c.lots.length);
  gate('blocks within ±15% of 264', within(c.blocks.length, 264 * 0.85, 264 * 1.15), c.blocks.length);
  const ni = c.lots.filter((l) => !l.interior);
  const missing = ni.filter((l) => l.seamT === undefined || l.other === undefined || !l.walk || !l.fP || l.era === undefined);
  gate('every non-interior lot has seamT/other/walk/fP/era', missing.length === 0, `${missing.length} missing of ${ni.length}`);
  const ids = new Set(p.relations.edges.map((e) => e.id));
  const badRel = [];
  for (const s of p.streets) if (!ids.has(s.rel)) badRel.push(`street ${s.id}`);
  for (const r of p.radials) if (!ids.has(r.rel)) badRel.push(`radial ${r.id}`);
  for (const t of p.thresholds) if (!ids.has(t.rel)) badRel.push(`thr ${t.id}`);
  for (const l of c.roadLines) if (l.spine === 'radial' && !ids.has(l.rel)) badRel.push(`line ${l.id}`);
  gate('street/radial/threshold rel resolves', badRel.length === 0, badRel.slice(0, 6).join(','));
  const sf = p.squares.filter((q) => q.kind === 'stationFront');
  const unmarked = sf.filter((q) => c.lots.some((l) => l.square === q.id && !l.interior) && !c.lots.some((l) => l.stationBuilding === q.id));
  gate('stationBuilding on every qualifying stationFront square', unmarked.length === 0, `${sf.length - unmarked.length}/${sf.length} squares marked`);
  const tm = c.timings;
  console.log('  timings:', Object.entries(tm).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · '));
  gate('history ≤ 60 ms', tm.history <= 60, tm.history.toFixed(0));
  gate('plan ≤ 220 ms', tm.plan <= 220, tm.plan.toFixed(0));
  gate('roads ≤ 450 ms', tm.roads <= 450, tm.roads.toFixed(0));
  gate('lots ≤ 140 ms', tm.lots <= 140, tm.lots.toFixed(0));
  if (c.timingsA) gate('flow0 A-part ≤ 220 ms', c.timingsA.flow0A <= 220, c.timingsA.flow0A.toFixed(0));
  if (full && c.metrics) console.log(`  full pipeline: entities ${c.metrics.entities}, buildings ${c.metrics.buildings}, total ${c.timings.total.toFixed(0)} ms`);
  return c;
}

// ---- 3) 스윕 ----
const SWEEP = ['lumina', 'sakura-101', 'halo-7', 'aurora-42', 'kivo-999', 'nova-3', 'iris-55', 'hikari-808', 'yume-12', 'a', 'Z', 'mirai-1', 'kivo-2', 'stella-3', 'yume-4'];
function median(a) { const s = a.filter((v) => typeof v === 'number').sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; }
function sweep() {
  console.log('\n[3] 스윕 15 시드 × 밀도 0.85/1/1.2 {plan:true, arch:0} (A 단계)');
  const dens = [0.85, 1, 1.2];
  let open = 0, exc = 0;
  const acadRes = [], harborMouth = [];
  for (const seed of SWEEP) {
    for (const d of dens) {
      let c;
      try { c = devGenerateA(seed, { plan: true, arch: 0, density: d }); } catch (e) {
        exc++; console.log(`  ${seed} d=${d} EXCEPTION ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue;
      }
      const st = (c.plan && c.plan.stats) || {};
      if (!c.plan || !st.ringClosed) open++;
      const bad = [];
      if (!c.plan) bad.push('noplan');
      if (!(st.stations >= 4)) bad.push('stations');
      if (!(st.gakuenCoverage >= 0.75)) bad.push('gakuen');
      if (!(st.mainShare <= 0.30)) bad.push('mainShare');
      if (d === 1) {
        for (const v of Object.values(st.acadResDist || {})) acadRes.push(v);
        if (st.harborMouth !== null && st.harborMouth !== undefined) harborMouth.push(st.harborMouth);
      }
      if (bad.length) failures++;
      console.log(`  ${seed.padEnd(11)} d=${d} ${c.timings.total.toFixed(0).padStart(5)}ms ring=${st.ringClosed ? 'closed' : 'OPEN'} ${st.ringCoverageDeg}° ${st.ringLen}m rad=${st.radials}/${st.radialsTerminated} st=${st.stations} gak=${st.gakuenCoverage} ms=${st.mainShare} thr=${st.thresholds} rel=${st.relations}/${st.relationRealized} old=${st.oldRoadKm} tj=${st.tJunctions} lots=${c.lots.length} blk=${c.blocks.length} plan=${c.timings.plan.toFixed(0)} roads=${c.timings.roads.toFixed(0)}${bad.length ? '  ⚠ ' + bad.join(',') : ''}`);
    }
  }
  gate('sweep: no exceptions', exc === 0, exc);
  gate('sweep: at most 1 open ring', open <= 1, open);
  gate('sweep: median academy→residential ≤ 320', median(acadRes) <= 320, median(acadRes));
  gate('sweep: median harbor→mouth ≤ 180', median(harborMouth) <= 180, median(harborMouth));
}

// ---- 4) 결정론 ----
function determinism(seed) {
  console.log('\n[4] 결정론');
  const a = devGenerateA(seed, { plan: true, arch: 0 }), b = devGenerateA(seed, { plan: true, arch: 0 });
  const sa = JSON.stringify(a.plan && a.plan.stats), sb = JSON.stringify(b.plan && b.plan.stats);
  gate('plan.stats identical', sa === sb);
  gate('roadLine checksum identical', hashArr(a.roadLine) === hashArr(b.roadLine), hashArr(a.roadLine));
  gate('lots identical', aFingerprint(a).lots === aFingerprint(b).lots);
}

// ---- 5) 디버그 PNG ----
function writeDebugPng(c, file) {
  const N = 1024, H = 512;
  const img = new Uint8Array(N * N * 3);
  const T = c.terrain.data, R = c.road.data, Z = c.zone.data, D = c.district.data;
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const DC = c.districtColor;
  for (let id = 0; id < N * N; id++) {
    const i = id % N, j = (id / N) | 0;
    let col;
    if (T[id] === 0) col = [70, 140, 200];
    else if (T[id] !== 1 && !R[id]) col = [90, 165, 220];
    else if (R[id]) col = R[id] === 5 ? [205, 203, 196] : R[id] === 6 ? [240, 238, 230] : R[id] === 8 ? [222, 205, 160] : R[id] === 11 ? [200, 181, 151] : R[id] === 3 ? [150, 140, 128] : R[id] === 9 ? [150, 155, 165] : [110, 112, 120];
    else if (Z[id] === 2) col = [170, 215, 150];
    else if (Z[id] === 1) col = hex(c.districts[D[id]].color).map((v) => Math.max(0, v - 25));
    else if (DC) { const k = ((j >> 2) * DC.n + (i >> 2)) * 3; col = [DC.rgb[k], DC.rgb[k + 1], DC.rgb[k + 2]]; }
    else col = hex(c.districts[D[id]].color);
    img[id * 3] = col[0]; img[id * 3 + 1] = col[1]; img[id * 3 + 2] = col[2];
  }
  const put = (x, z, col, r) => {
    const ci = Math.floor(x + H), cj = Math.floor(z + H);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r * r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const id = j * N + i; img[id * 3] = col[0]; img[id * 3 + 1] = col[1]; img[id * 3 + 2] = col[2];
    }
  };
  const poly = (pts, col, r) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= L; s += 1) put(a.x + ((b.x - a.x) * s) / (L || 1), a.z + ((b.z - a.z) * s) / (L || 1), col, r);
    }
  };
  const ring = (x, z, r, col) => { for (let a = 0; a < 64; a++) put(x + Math.cos((a / 64) * 6.283) * r, z + Math.sin((a / 64) * 6.283) * r, col, 1); };
  const p = c.plan;
  if (p) {
    for (const sq of p.squares) put(sq.x, sq.z, [255, 255, 255], Math.max(3, Math.round(sq.r * 0.6)));
    poly(p.ring.pts, [35, 38, 50], 3);
    for (const r of p.radials) poly(r.pts, r.kind === 'trunk' ? [55, 58, 75] : [90, 92, 110], 2);
    if (c.history) for (const o of c.history.oldRoads) poly(o.pts, [160, 120, 74], 2);
    for (const s of p.streets) poly(s.pts, hex(s.accent), 2);
    for (const s of p.stations) put(s.x, s.z, [0, 220, 255], s.spur ? 6 : 5);
    for (const t of p.thresholds) ring(t.x, t.z, 7, [224, 65, 59]);
    for (const g of c.gates || []) put(g.x, g.z, [255, 60, 160], 3);
    for (const d of p.dests) put(d.x, d.z, [255, 200, 0], 2);
  }
  if (c.history) { put(c.history.origin.x, c.history.origin.z, [120, 60, 20], 5); put(c.history.ford.x, c.history.ford.z, [120, 60, 20], 4); if (c.history.sacred) put(c.history.sacred.x, c.history.sacred.z, [20, 120, 40], 5); }
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let y = 0; y < N; y++) { raw[y * (N * 3 + 1)] = 0; Buffer.from(img.buffer, y * N * 3, N * 3).copy(raw, y * (N * 3 + 1) + 1); }
  const crcT = new Uint32Array(256).map((_, n) => { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; return x >>> 0; });
  const crc = (buf) => { let x = 0xffffffff; for (const b of buf) x = crcT[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('  png →', file);
}

// ---- main ----
const seed = opt('--seed', 'lumina');
if (flag('--png')) {
  const c = devGenerateA(seed, { plan: true, arch: 0 });
  writeDebugPng(c, opt('--png', 'plan-debug.png'));
}
if (!flag('--no-parity')) await parity(flag('--quick') ? ['lumina'] : ['lumina', 'kivotos', 'academy-7']);
if (!flag('--parity-only')) {
  planGates(seed);
  determinism(seed);
  if (flag('--sweep')) sweep();
}
console.log(`\n${failures ? `FAILED: ${failures} gate(s)` : 'ALL PASS'} (${results.length} gates)`);
process.exit(failures ? 1 : 0);
