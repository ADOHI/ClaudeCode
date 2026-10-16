// 매크로 1단계: 섬 지형, 만(灣), 하천. (Lynch: Edges)
import { Noise2D, smoothstep } from './rng.js';
import { Grid, edt, angleWrap } from './grid.js';
import { TERRAIN, WORLD } from './config.js';

export function genTerrain(ctx) {
  const rng = ctx.rng.fork('terrain');
  const nz = new Noise2D(rng);
  const N = WORLD.size, H = WORLD.half;
  const terrain = new Grid(N, N, 1, -H, -H, Uint8Array);

  // 4m 해상도로 고도 계산 후 쌍선형 보간 (해안선이 부드럽게)
  const coarse = new Grid(N / 4 + 1, N / 4 + 1, 4, -H - 2, -H - 2, Float32Array);
  const bayAngle = rng.range(-Math.PI, Math.PI);
  const R0 = 455;
  for (let j = 0; j < coarse.h; j++) {
    for (let i = 0; i < coarse.w; i++) {
      const x = coarse.cx(i), z = coarse.cz(j);
      const r = Math.hypot(x, z);
      let e = 1 - Math.pow(r / R0, 2.4);
      e += 0.28 * nz.fbm(x / 260, z / 260, 4) + 0.07 * nz.fbm(x / 60 + 11, z / 60 - 7, 2);
      const da = angleWrap(Math.atan2(z, x) - bayAngle);
      e -= 0.95 * Math.exp(-((da / 0.3) ** 2)) * smoothstep(230, 460, r); // 항구용 만
      e += 0.6 * Math.exp(-((r / 210) ** 2)); // 중심부는 반드시 육지
      coarse.data[j * coarse.w + i] = e;
    }
  }
  const T = terrain.data;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const e = coarse.bilinear(terrain.cx(i), terrain.cz(j));
      // 월드 가장자리는 항상 바다
      const edge = Math.max(Math.abs(terrain.cx(i)), Math.abs(terrain.cz(j)));
      T[j * N + i] = e > 0 && edge < H - 12 ? TERRAIN.LAND : TERRAIN.SEA;
    }
  }

  // 하천: 섬을 가로지르되 중심(중앙광장)에서 110~160m 비켜 지나간다
  const a1 = bayAngle + Math.PI / 2 + rng.range(-0.45, 0.45);
  const a2 = a1 + Math.PI + rng.range(-0.5, 0.5);
  const S = [Math.cos(a1) * 620, Math.sin(a1) * 620];
  const E = [Math.cos(a2) * 620, Math.sin(a2) * 620];
  let nx = -(E[1] - S[1]), nzv = E[0] - S[0];
  const nl = Math.hypot(nx, nzv);
  nx /= nl;
  nzv /= nl;
  const off = rng.range(120, 165) * rng.sign();
  // 중점이 M을 지나도록 제어점 계산 (2차 베지어)
  const mid = [(S[0] + E[0]) / 2, (S[1] + E[1]) / 2];
  // mid를 원점에 투영 후 오프셋 (선이 원점 부근을 지나도록)
  const proj = mid[0] * nx + mid[1] * nzv;
  const M = [mid[0] - proj * nx + nx * off, mid[1] - proj * nzv + nzv * off];
  const C = [2 * M[0] - mid[0], 2 * M[1] - mid[1]];
  const pts = [];
  const STEPS = 420;
  for (let s = 0; s <= STEPS; s++) {
    const t = s / STEPS;
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    let x = a * S[0] + b * C[0] + c * E[0];
    let z = a * S[1] + b * C[1] + c * E[1];
    // 곡류(meander)
    const tx = 2 * (1 - t) * (C[0] - S[0]) + 2 * t * (E[0] - C[0]);
    const tz = 2 * (1 - t) * (C[1] - S[1]) + 2 * t * (E[1] - C[1]);
    const tl = Math.hypot(tx, tz) || 1;
    const m = 24 * nz.noise(t * 5.5, 3.3);
    x += (-tz / tl) * m;
    z += (tx / tl) * m;
    const width = 17 + 5 * (nz.noise(t * 3, 9.1) + 1) * 0.5;
    pts.push({ x, z, w: width });
  }
  for (let s = 0; s < pts.length - 1; s++) {
    const p = pts[s], q = pts[s + 1];
    const hw = (p.w + q.w) / 4;
    const steps = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z));
    for (let k = 0; k <= steps; k++) {
      const t = k / Math.max(1, steps);
      const x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      const r = Math.ceil(hw);
      const ci = terrain.ci(x), cj = terrain.cj(z);
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ii = ci + di, jj = cj + dj;
          if (!terrain.inside(ii, jj)) continue;
          const dx = terrain.cx(ii) - x, dz = terrain.cz(jj) - z;
          if (dx * dx + dz * dz <= hw * hw) {
            const id = jj * N + ii;
            if (T[id] === TERRAIN.LAND) T[id] = TERRAIN.RIVER;
          }
        }
      }
    }
  }
  ctx.river = pts.filter((p) => Math.abs(p.x) < H && Math.abs(p.z) < H);
  ctx.terrain = terrain;
  ctx.bayAngle = bayAngle;
  computeWaterFields(ctx);
  ctx.riverMouths = findRiverMouths(ctx);
  ctx.log('macro.island', `만 방위 ${(bayAngle * 180 / Math.PI).toFixed(0)}°, 하천 중심 이격 ${Math.abs(off).toFixed(0)}m`);
}

/**
 * 하구(river mouth): 하천 폴리라인을 양 끝에서 안쪽으로 걸어 처음 만나는 RIVER 셀.
 * 그 지점이 바다에서 14m 이내면 하구다. 순수 계산 (RNG 없음) — 항상 기록한다.
 */
export function findRiverMouths(ctx) {
  const N = WORLD.size, H = WORLD.half;
  const T = ctx.terrain.data, pts = ctx.river || [];
  const mouths = [];
  const cell = (p) => {
    const i = Math.floor(p.x + H), j = Math.floor(p.z + H);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  };
  for (const dir of [1, -1]) {
    const start = dir > 0 ? 0 : pts.length - 1;
    for (let k = start; k >= 0 && k < pts.length; k += dir) {
      const id = cell(pts[k]);
      if (id < 0 || T[id] !== TERRAIN.RIVER) continue;
      if (ctx.distSea[id] < 14) mouths.push({ x: pts[k].x, z: pts[k].z });
      break;
    }
  }
  return mouths;
}

export function computeWaterFields(ctx) {
  const N = WORLD.size;
  const T = ctx.terrain.data;
  ctx.distSea = edt((i) => T[i] === TERRAIN.SEA, N, N);
  ctx.distWater = edt((i) => T[i] !== TERRAIN.LAND, N, N);
  ctx.distRiver = edt((i) => T[i] === TERRAIN.RIVER, N, N);
}
