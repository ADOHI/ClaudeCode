// 지면 텍스처: 래스터(지형/도로/존/구역) 픽셀 패스 + 벡터 데칼(차선, 횡단보도, 트랙, 광장 패턴).
import { WORLD, TERRAIN, ROAD, ZONE } from '../core/config.js';

const N = WORLD.size, H = WORLD.half;
const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const ROAD_RGB = {
  [ROAD.MAIN]: hex('#5f6472'), [ROAD.MINOR]: hex('#787d8b'), [ROAD.ALLEY]: hex('#b3a794'), [ROAD.COAST]: hex('#6a7482'),
  [ROAD.SIDEWALK]: hex('#dcd7cc'), [ROAD.PLAZA]: hex('#e6e1d5'), [ROAD.CAMPUS_PATH]: hex('#e2d6bf'), [ROAD.PARK_PATH]: hex('#e8d6a8'),
  [ROAD.BRIDGE]: hex('#a3abb6'), [ROAD.PIER]: hex('#8f7f6a'),
};

export function paintGround(ctx, scale = 2) {
  const S = N * scale;
  const base = makeCanvas(N, N);
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(N, N);
  const px = img.data;
  const T = ctx.terrain.data, R = ctx.road.data, Z = ctx.zone.data, D = ctx.district.data;
  const dcol = ctx.districts.map((d) => hex(d.color));
  const sea = hex('#7cc3ea'), river = hex('#86cdef'), sand = hex('#efe2bf'), lawn = hex('#a9d78f');
  for (let id = 0; id < N * N; id++) {
    let c;
    const r = R[id];
    if (r) c = ROAD_RGB[r] || ROAD_RGB[ROAD.MINOR];
    else if (T[id] === TERRAIN.SEA) c = sea;
    else if (T[id] !== TERRAIN.LAND) c = river;
    else if (Z[id] === ZONE.PARK) c = lawn;
    else if (ctx.distSea[id] < 3.5) c = sand;
    else if (Z[id] === ZONE.CAMPUS) { const d = dcol[D[id]]; c = [Math.min(255, d[0] + 8), Math.min(255, d[1] + 8), Math.min(255, d[2] + 8)]; }
    else c = D[id] === 255 ? sea : dcol[D[id]];
    // 미세한 결 (같은 색 평면이 단조롭지 않게)
    const n = ((id * 2654435761) >>> 24) & 7;
    const k = 1 - n * 0.006;
    px[id * 4] = c[0] * k; px[id * 4 + 1] = c[1] * k; px[id * 4 + 2] = c[2] * k; px[id * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  const canvas = makeCanvas(S, S);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(base, 0, 0, S, S);
  const P = (x) => (x + H) * scale;
  // 데칼
  for (const dc of ctx.decals) drawDecal(g, dc, P, scale);
  // 차선: 간선 중앙 점선, 해안도로 실선
  g.lineCap = 'butt';
  for (const l of ctx.roadLines) {
    if (l.removed || (l.level !== 1 && l.level !== 4)) continue;
    g.strokeStyle = l.level === 1 ? 'rgba(255,255,255,0.85)' : 'rgba(255,214,90,0.9)';
    g.lineWidth = 0.35 * scale;
    g.setLineDash(l.level === 1 ? [3 * scale, 3 * scale] : []);
    g.beginPath();
    l.pts.forEach((p, i) => (i ? g.lineTo(P(p.x), P(p.z)) : g.moveTo(P(p.x), P(p.z))));
    g.stroke();
  }
  g.setLineDash([]);
  return canvas;
}

function drawDecal(g, dc, P, scale) {
  g.save();
  g.translate(P(dc.x), P(dc.z));
  if (dc.rot) g.rotate(dc.rot);
  const w = dc.w * scale, d = dc.d * scale;
  switch (dc.shape) {
    case 'rect':
      g.fillStyle = dc.color;
      g.fillRect(-w / 2, -d / 2, w, d);
      if (dc.stripes) {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 0.15 * scale;
        for (let x = -w / 2 + 2.8 * scale; x < w / 2; x += 2.8 * scale) { g.beginPath(); g.moveTo(x, -d / 2); g.lineTo(x, -d / 2 + 5 * scale); g.stroke(); }
      }
      break;
    case 'circle':
      g.fillStyle = dc.color;
      g.beginPath(); g.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2); g.fill();
      break;
    case 'ring':
      g.strokeStyle = dc.color;
      g.lineWidth = (dc.line || 1) * scale;
      g.beginPath(); g.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2); g.stroke();
      break;
    case 'crosswalk': {
      // w: 진행방향 폭, d: 도로 폭 → 진행 방향과 평행한 흰 띠
      g.fillStyle = 'rgba(250,250,250,0.92)';
      for (let y = -d / 2 + 0.4 * scale; y < d / 2 - 0.4 * scale; y += 1.2 * scale) g.fillRect(-w / 2, y, w, 0.6 * scale);
      break;
    }
    case 'track': {
      // 운동장: 붉은 트랙 + 녹색 필드 + 흰 레인
      const r = Math.min(w, d) / 2;
      g.fillStyle = '#c96f4a';
      roundRect(g, -w / 2, -d / 2, w, d, r); g.fill();
      g.fillStyle = '#7fbf6a';
      roundRect(g, -w / 2 + 5 * scale, -d / 2 + 5 * scale, w - 10 * scale, d - 10 * scale, Math.max(1, r - 5 * scale)); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.2 * scale;
      for (let k = 1; k < 4; k++) { roundRect(g, -w / 2 + k * 1.2 * scale, -d / 2 + k * 1.2 * scale, w - k * 2.4 * scale, d - k * 2.4 * scale, Math.max(1, r - k * 1.2 * scale)); g.stroke(); }
      g.beginPath(); g.moveTo(0, -d / 2 + 5 * scale); g.lineTo(0, d / 2 - 5 * scale); g.stroke();
      break;
    }
    default:
      break;
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---- 분석 오버레이 (히트맵) ----
const RAMPS = {
  flow: [[0, [255, 255, 255, 0]], [0.35, [255, 220, 120, 90]], [0.7, [255, 140, 60, 170]], [1, [230, 40, 60, 220]]],
  hidden: [[0, [60, 140, 255, 0]], [0.5, [120, 90, 220, 90]], [0.8, [190, 70, 200, 170]], [1, [255, 210, 60, 220]]],
  gap: [[0, [60, 200, 120, 150]], [0.5, [250, 220, 70, 170]], [1, [235, 60, 60, 210]]],
  detour: [[0, [70, 170, 255, 0]], [0.15, [70, 170, 255, 120]], [0.5, [150, 110, 255, 170]], [1, [255, 90, 200, 210]]],
};
function ramp(name, t) {
  const R = RAMPS[name];
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < R.length; i++) {
    if (t <= R[i][0]) {
      const [t0, a] = R[i - 1], [t1, b] = R[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return a.map((v, k) => v + (b[k] - v) * u);
    }
  }
  return R[R.length - 1][1];
}

export function paintOverlay(ctx, kind) {
  const n2 = N / WORLD.ana;
  const c = makeCanvas(n2, n2);
  const g = c.getContext('2d');
  const img = g.createImageData(n2, n2);
  const px = img.data;
  const walk = ctx.cost2;
  for (let k = 0; k < n2 * n2; k++) {
    let col = null;
    if (kind === 'district') {
      const i = (k % n2) * 2, j = ((k / n2) | 0) * 2;
      const d = ctx.district.data[j * N + i];
      if (d !== 255) { const h = hex(ctx.districts[d].accent); col = [h[0], h[1], h[2], 120]; }
    } else if (walk[k] > 0) {
      if (kind === 'flow') col = ramp('flow', ctx.flow.data[((k / n2 / 2) | 0) * (n2 / 2) + ((k % n2) >> 1)]);
      else if (kind === 'hidden') col = ramp('hidden', ctx.hidden[k]);
      else if (kind === 'gap') { const v = ctx.poiDist ? ctx.poiDist[k] : Infinity; col = isFinite(v) ? ramp('gap', v / 96) : [235, 60, 60, 210]; if (!ctx.isFlow2[k] && isFinite(v)) col[3] *= 0.35; }
      else if (kind === 'detour') { const v = ctx.detour[k]; col = isFinite(v) ? ramp('detour', v / 120) : [255, 90, 200, 210]; }
    }
    if (col) { px[k * 4] = col[0]; px[k * 4 + 1] = col[1]; px[k * 4 + 2] = col[2]; px[k * 4 + 3] = col[3]; }
  }
  g.putImageData(img, 0, 0);
  return c;
}
