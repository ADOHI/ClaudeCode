// 2층 높이장(layered heightfield) 충돌: 지면 고정 고체의 상면(floor) + 공중 데크(deckB/deckT).
// 엔진 독립: Unity/Unreal 임포트 시 NavMesh 베이크 전 빠른 검증용으로도 쓸 수 있다.
import { WORLD, TERRAIN, ROAD } from './config.js';
import { Grid, forEachCellInOBB } from './grid.js';

const H = WORLD.half, N = WORLD.size;

export function buildCollision(ctx) {
  const floor = new Float32Array(N * N);
  const deckB = new Float32Array(N * N).fill(1e9);
  const deckT = new Float32Array(N * N).fill(-1e9);
  const blocked = new Uint8Array(N * N); // 1 물, 2 오를 수 없는 벽(담장/잠긴 문)
  const T = ctx.terrain.data, R = ctx.road.data;
  for (let id = 0; id < N * N; id++) {
    if (T[id] !== TERRAIN.LAND && R[id] !== ROAD.BRIDGE && R[id] !== ROAD.PIER) { blocked[id] = 1; floor[id] = -1.2; }
  }
  const g = new Grid(N, N, 1, -H, -H);
  const ents = ctx.entities.filter((e) => e.solid && !e.deleted).sort((a, b) => a.y - b.y);
  const gateCells = new Map();
  for (const e of ents) {
    const minDim = Math.min(e.w, e.d);
    const pad = minDim < 1 ? (1 - minDim) / 2 : 0;
    const round = e.shape === 'cyl' || e.shape === 'sphere' || e.shape === 'cone' || e.shape === 'torus' || e.shape === 'oct';
    const o = { x: e.x, z: e.z, w: e.w, d: e.d, rot: round ? 0 : e.rot || 0 };
    const top = e.y + e.h;
    const c = Math.cos(o.rot), s = Math.sin(o.rot);
    const noClimb = e.cat === 'wall' || e.kind === 'lockgate' || e.kind === 'rooffence' || e.kind === 'fence';
    const cells = [];
    forEachCellInOBB(g, o, (id, i, j) => {
      if (round) {
        const dx = (i - H + 0.5 - e.x) / (e.w / 2 + pad), dz = (j - H + 0.5 - e.z) / (e.d / 2 + pad);
        if (dx * dx + dz * dz > 1) return;
      }
      cells.push(id);
      if (e.walkOverWater && blocked[id] === 1) { blocked[id] = 0; floor[id] = -1.2; }
      if (e.shape === 'ramp') {
        const x = i - H + 0.5 - e.x, z = j - H + 0.5 - e.z;
        const u = x * c + z * s;
        const hh = e.y + e.h * Math.max(0, Math.min(1, u / e.w + 0.5));
        if (hh > floor[id]) floor[id] = hh;
        return;
      }
      const elevated = e.deck || e.y > 0.6;
      if (elevated && e.y > floor[id] + 0.35) {
        if (e.y < deckB[id]) deckB[id] = e.y;
        if (top > deckT[id]) deckT[id] = top;
      } else if (top > floor[id]) {
        floor[id] = top;
      }
      if (noClimb) blocked[id] = Math.max(blocked[id], 2);
    }, pad);
    if (e.kind === 'lockgate') gateCells.set(e.gate, cells);
  }
  return { floor, deckB, deckT, blocked, gateCells, N, H };
}

/** 해당 지점에서 서 있을 수 있는 가장 높은 면 (y + step 이하) */
export function supportAt(col, x, z, y, step = 0.6) {
  const i = Math.floor(x + col.H), j = Math.floor(z + col.H);
  if (i < 0 || j < 0 || i >= col.N || j >= col.N) return -1e9;
  const id = j * col.N + i;
  let s = col.floor[id] <= y + step ? col.floor[id] : -1e9;
  if (col.deckT[id] > -1e8 && col.deckT[id] <= y + step && col.deckT[id] > s) s = col.deckT[id];
  return s;
}
