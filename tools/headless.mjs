// 헤드리스 생성: 단계 타이밍, 로그, 지표 출력 + 탑다운 PNG 지도 (검증용).
// 사용: node tools/headless.mjs [seed] [--png out.png] [--json out.json]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateSync } from '../src/core/generator.js';
import { WORLD, TERRAIN, ROAD, ZONE } from '../src/core/config.js';
import { Grid, forEachCellInOBB } from '../src/core/grid.js';
import { exportWorld } from '../src/core/export.js';

const args = process.argv.slice(2);
const seed = args.find((a) => !a.startsWith('--')) || 'lumina';
const pngIdx = args.indexOf('--png');
const jsonIdx = args.indexOf('--json');

const ctx = generateSync(seed, (key, label, c) => {
  process.stdout.write(`  ✓ ${label.padEnd(18)} ${c.timings[key].toFixed(0).padStart(6)} ms\n`);
});
console.log(`\nseed=${seed} total=${ctx.timings.total.toFixed(0)}ms`);
for (const l of ctx.logs) console.log(`  [${l.name}] ${l.msg}`);
console.log('\nmetrics:', JSON.stringify(ctx.metrics, null, 1));
console.log('districts:', ctx.districts.map((d) => `${d.name}(${d.type})`).join(', '));

if (pngIdx >= 0) writePng(ctx, args[pngIdx + 1] || 'map.png');
if (jsonIdx >= 0) writeFileSync(args[jsonIdx + 1] || 'world.json', JSON.stringify(exportWorld(ctx)));

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function writePng(ctx, file) {
  const N = WORLD.size, H = WORLD.half;
  const img = new Uint8Array(N * N * 3);
  const T = ctx.terrain.data, R = ctx.road.data, Z = ctx.zone.data, D = ctx.district.data;
  const roadCol = {
    [ROAD.MAIN]: [70, 72, 80], [ROAD.MINOR]: [105, 108, 116], [ROAD.ALLEY]: [150, 140, 128], [ROAD.COAST]: [80, 90, 100],
    [ROAD.SIDEWALK]: [200, 198, 192], [ROAD.PLAZA]: [228, 225, 216], [ROAD.CAMPUS_PATH]: [214, 206, 190],
    [ROAD.PARK_PATH]: [222, 205, 160], [ROAD.BRIDGE]: [150, 155, 165], [ROAD.PIER]: [138, 122, 102],
  };
  for (let id = 0; id < N * N; id++) {
    let c;
    if (R[id]) c = roadCol[R[id]];
    else if (T[id] === TERRAIN.SEA) c = [70, 140, 200];
    else if (T[id] === TERRAIN.RIVER || T[id] === TERRAIN.LAKE) c = [90, 165, 220];
    else if (Z[id] === ZONE.PARK) c = [170, 215, 150];
    else if (Z[id] === ZONE.CAMPUS) c = hex(ctx.districts[D[id]].color).map((v) => Math.min(255, v + 10));
    else c = D[id] === 255 ? [0, 0, 0] : hex(ctx.districts[D[id]].color);
    img[id * 3] = c[0]; img[id * 3 + 1] = c[1]; img[id * 3 + 2] = c[2];
  }
  const g = new Grid(N, N, 1, -H, -H, Uint8Array);
  const paint = (e, col) => forEachCellInOBB(g, { x: e.x, z: e.z, w: e.w, d: e.d, rot: e.shape === 'box' || e.shape === 'gable' || e.shape === 'ramp' ? e.rot : 0 }, (id) => { img[id * 3] = col[0]; img[id * 3 + 1] = col[1]; img[id * 3 + 2] = col[2]; });
  for (const e of ctx.entities) {
    if (e.deleted) continue;
    if (e.cat === 'building' && e.y < 1) { const c = hex(e.color); paint(e, c.map((v) => v * 0.78)); }
    else if (e.cat === 'wall') paint(e, [90, 80, 70]);
    else if (e.cat === 'landmark' && e.y < 1) paint(e, [230, 40, 90]);
    else if (e.kind === 'container') paint(e, hex(e.color));
    else if (e.cat === 'rail' && e.kind === 'track') paint({ ...e, d: 2 }, [40, 60, 160]);
  }
  const dot = (x, z, r, col) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const i = Math.floor(x + H + dx), j = Math.floor(z + H + dz);
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const id = j * N + i;
      img[id * 3] = col[0]; img[id * 3 + 1] = col[1]; img[id * 3 + 2] = col[2];
    }
  };
  for (const p of ctx.pois) if (!p.deleted) dot(p.x, p.z, p.tier === 1 ? 4 : 2, p.tier === 1 ? [0, 200, 255] : [80, 220, 170]);
  for (const s of ctx.secrets) dot(s.x, s.z, 4, [255, 210, 0]);
  for (const r of ctx.routes.crumbs) for (const [x, z] of r.pts) dot(x, z, 0, [0, 255, 255]);
  for (const l of ctx.landmarks) dot(l.x, l.z, 6, [255, 40, 100]);
  // PNG 인코딩
  const raw = Buffer.alloc((N * 3 + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (N * 3 + 1)] = 0;
    Buffer.from(img.buffer, y * N * 3, N * 3).copy(raw, y * (N * 3 + 1) + 1);
  }
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(file, png);
  console.log('png →', file);
}
