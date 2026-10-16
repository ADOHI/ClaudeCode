// 이음매(경계 띠): 두 구역 사이 필지의 경계 여유(seamT)와 이웃 구역(other), 역 빌딩 지정,
// 그리고 지면 색 블렌딩용 구역 색 필드(256² RGB, 4m). (C§8 C1–C2, plan §1 D5·D6)
import { WORLD, PLAN } from './config.js';
import { smoothstep } from './rng.js';

const H = WORLD.half, N = WORLD.size;

const cellAt = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

/** 경계 여유 t ∈ [0,1]: 0 = 보로노이 경계 위, 1 = 구역 코어 (band m 이상 안쪽). 데이터가 없으면 1. */
export function seamTAt(ctx, x, z) {
  if (!ctx.seamMargin) return 1;
  const id = cellAt(x, z);
  if (id < 0) return 1;
  return smoothstep(0, PLAN.seam.band, ctx.seamMargin[id]);
}

function hexRGB(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 두 hex 색의 선형 보간 → hex 문자열 */
export function lerpColor(hexA, hexB, t) {
  const a = hexRGB(hexA), b = hexRGB(hexB);
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * u));
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
}

/**
 * 구역 색 필드: 4m 셀 중심의 구역 지면색 → 바다는 가장 가까운 육지 색 → 반경 4셀 박스 블러 2회.
 * ctx.districtColor = {n:256, cell:4, ox:-512, oz:-512, rgb:Uint8ClampedArray(256²·3)}
 */
export function districtColorField(ctx) {
  const S = 4, n = N / S;
  const D = ctx.district.data;
  const pal = ctx.districts.map((d) => hexRGB(d.color));
  const r = new Float32Array(n * n), g = new Float32Array(n * n), b = new Float32Array(n * n);
  const seen = new Uint8Array(n * n);
  const queue = new Int32Array(n * n);
  let qh = 0, qt = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const dd = D[(j * S + 2) * N + i * S + 2];
      if (dd === 255 || !pal[dd]) continue;
      const c = pal[dd];
      r[k] = c[0]; g[k] = c[1]; b[k] = c[2];
      seen[k] = 1;
      queue[qt++] = k;
    }
  }
  // 바다: 4-이웃 BFS로 가장 가까운 육지 색 전파
  while (qh < qt) {
    const k = queue[qh++];
    const i = k % n, j = (k / n) | 0;
    for (let q = 0; q < 4; q++) {
      const ii = i + (q === 0 ? 1 : q === 1 ? -1 : 0), jj = j + (q === 2 ? 1 : q === 3 ? -1 : 0);
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const m = jj * n + ii;
      if (seen[m]) continue;
      seen[m] = 1;
      r[m] = r[k]; g[m] = g[k]; b[m] = b[k];
      queue[qt++] = m;
    }
  }
  const tmp = new Float32Array(n * n);
  const R = 4;
  const blur = (src) => {
    for (let pass = 0; pass < 2; pass++) {
      // 가로
      for (let j = 0; j < n; j++) {
        let s = 0, c = 0;
        for (let i = 0; i <= R && i < n; i++) { s += src[j * n + i]; c++; }
        for (let i = 0; i < n; i++) {
          tmp[j * n + i] = s / c;
          const add = i + R + 1, rem = i - R;
          if (add < n) { s += src[j * n + add]; c++; }
          if (rem >= 0) { s -= src[j * n + rem]; c--; }
        }
      }
      // 세로
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let j = 0; j <= R && j < n; j++) { s += tmp[j * n + i]; c++; }
        for (let j = 0; j < n; j++) {
          src[j * n + i] = s / c;
          const add = j + R + 1, rem = j - R;
          if (add < n) { s += tmp[add * n + i]; c++; }
          if (rem >= 0) { s -= tmp[rem * n + i]; c--; }
        }
      }
    }
  };
  blur(r); blur(g); blur(b);
  const rgb = new Uint8ClampedArray(n * n * 3);
  for (let k = 0; k < n * n; k++) {
    rgb[k * 3] = Math.round(r[k]);
    rgb[k * 3 + 1] = Math.round(g[k]);
    rgb[k * 3 + 2] = Math.round(b[k]);
  }
  ctx.districtColor = { n, cell: S, ox: -H, oz: -H, rgb };
  return ctx.districtColor;
}

/**
 * 필지 이음매 주석 (lots 단계, 계획 모드):
 * lot.seamT = smoothstep(0, 64, seamMargin@centre), lot.other = district2@centre,
 * lot.stationBuilding = 역전 광장 sq.id (그 광장에 면한 비안뜰 필지 중 최대 면적 하나).
 */
export function annotateLots(ctx) {
  const lots = ctx.lots || [];
  const SM = ctx.seamMargin, D2 = ctx.district2 ? ctx.district2.data : null;
  for (const lot of lots) {
    const id = cellAt(lot.x, lot.z);
    if (SM && id >= 0) lot.seamT = smoothstep(0, PLAN.seam.band, SM[id]);
    else lot.seamT = 1;
    let other = D2 && id >= 0 ? D2[id] : 255;
    if (other === 255 || other === undefined || !ctx.districts[other]) other = lot.district;
    lot.other = other;
  }
  const plan = ctx.plan;
  if (!plan || !plan.squares) return;
  let marked = 0;
  for (const sq of plan.squares) {
    if (sq.kind !== 'stationFront') continue;
    let best = null;
    for (const lot of lots) {
      if (lot.interior || lot.square !== sq.id || lot.landmark) continue;
      if (!best || lot.area > best.area) best = lot;
    }
    if (best) { best.stationBuilding = sq.id; sq.stationLot = best.id; marked++; }
  }
  if (marked) ctx.log('meso.station', `역 빌딩 부지 ${marked}곳 (역전 광장에 면한 최대 필지)`);
}
