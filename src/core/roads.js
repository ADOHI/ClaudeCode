// 매크로 3단계: 텐서장 기반 가로망 (Chen et al. 2008 "Interactive Procedural Street Modeling" 방식).
// 구역마다 기저 텐서장(방사/격자/해안 접선)을 두고 블렌딩 → 주(major)/부(minor) 고유벡터를 따라
// 균일 간격 유선(Jobard–Lefer seeding)을 추적한다. 간선(1) → 진입대로 → 해안도로 → 생활가로(2) 위계.
import { Noise2D } from './rng.js';
import { Grid, PointHash, segIntersect, segDist2 } from './grid.js';
import { TERRAIN, ROAD, ZONE, WORLD, ROAD_LEVELS } from './config.js';

const H = WORLD.half, N = WORLD.size;

export function buildTensorField(ctx) {
  const rng = ctx.rng.fork('tensor');
  const nz = new Noise2D(rng);
  const S = 8;
  const n = N / S + 1;
  const A = new Grid(n, n, S, -H - S / 2, -H - S / 2);
  const B = new Grid(n, n, S, -H - S / 2, -H - S / 2);
  for (const d of ctx.districts) d.gridAngle = rng.range(0, Math.PI);
  const grad = (field, x, z) => {
    const i = Math.max(1, Math.min(N - 2, Math.floor(x + H))), j = Math.max(1, Math.min(N - 2, Math.floor(z + H)));
    const r = 3;
    const i0 = Math.max(0, i - r), i1 = Math.min(N - 1, i + r), j0 = Math.max(0, j - r), j1 = Math.min(N - 1, j + r);
    return [field[j * N + i1] - field[j * N + i0], field[j1 * N + i] - field[j0 * N + i]];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = A.cx(i), z = A.cz(j);
      const cid = Math.max(0, Math.min(N - 1, Math.floor(z + H))) * N + Math.max(0, Math.min(N - 1, Math.floor(x + H)));
      let did = ctx.district.data[cid];
      if (did === 255) {
        // 바다: 가장 가까운 시드
        let bd = Infinity;
        for (const d of ctx.districts) { const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; did = d.id; } }
      }
      const d = ctx.districts[did];
      const def = d.def;
      let th;
      switch (def.field) {
        case 'radial': th = Math.atan2(z - (d.type === 'center' ? 0 : d.z), x - (d.type === 'center' ? 0 : d.x)); break;
        case 'toCenter': th = Math.atan2(d.z, d.x); break;
        case 'coast': {
          const g = grad(ctx.distSea, x, z);
          th = ctx.distSea[cid] < 140 && Math.hypot(g[0], g[1]) > 0.1 ? Math.atan2(g[1], g[0]) + Math.PI / 2 : d.gridAngle;
          break;
        }
        default: th = d.gridAngle;
      }
      th += def.noiseRot * 2.2 * nz.fbm(x / 170, z / 170, 3);
      let a = Math.cos(2 * th), b = Math.sin(2 * th);
      // 경계장: 해안·하천 접선 방향으로 끌어당김
      const ds = ctx.distSea[cid], dr = ctx.distRiver[cid];
      const wc = 1.4 * Math.exp(-ds / 30);
      if (wc > 0.02) {
        const g = grad(ctx.distSea, x, z);
        if (Math.hypot(g[0], g[1]) > 0.1) {
          const t = Math.atan2(g[1], g[0]) + Math.PI / 2;
          a += wc * Math.cos(2 * t); b += wc * Math.sin(2 * t);
        }
      }
      const wr = 1.2 * Math.exp(-dr / 26);
      if (wr > 0.02) {
        const g = grad(ctx.distRiver, x, z);
        if (Math.hypot(g[0], g[1]) > 0.1) {
          const t = Math.atan2(g[1], g[0]) + Math.PI / 2;
          a += wr * Math.cos(2 * t); b += wr * Math.sin(2 * t);
        }
      }
      A.data[j * n + i] = a;
      B.data[j * n + i] = b;
    }
  }
  // 구역 경계 블렌딩 (박스 블러)
  for (let pass = 0; pass < 4; pass++) {
    for (const G of [A, B]) {
      const src = G.data.slice();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          let s = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            s += src[jj * n + ii]; c++;
          }
          G.data[j * n + i] = s / c;
        }
      }
    }
  }
  ctx.tensor = { A, B };
}

export function tensorAngle(ctx, x, z) {
  const a = ctx.tensor.A.bilinear(x, z), b = ctx.tensor.B.bilinear(x, z);
  return 0.5 * Math.atan2(b, a);
}

function fieldDir(ctx, x, z, family) {
  const th = tensorAngle(ctx, x, z) + (family ? Math.PI / 2 : 0);
  return [Math.cos(th), Math.sin(th)];
}

// ---- 셀 조회 ----
const cellId = (x, z) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  if (i < 0 || j < 0 || i >= N || j >= N) return -1;
  return j * N + i;
};

export function genRoads(ctx) {
  const rng = ctx.rng.fork('roads');
  buildTensorField(ctx);
  const lines = [];
  const hashes = [new PointHash(16), new PointHash(16)]; // family별
  const allHash = new PointHash(12);
  ctx.roadLines = lines;
  ctx.roadHash = allHash;

  const T = ctx.terrain.data, Z = ctx.zone.data, D = ctx.district.data;
  const dsepMain = (x, z) => (Math.hypot(x, z) < 220 ? 105 : 128);
  const dsepMinor = (x, z) => {
    const id = cellId(x, z);
    const d = id >= 0 && D[id] !== 255 ? ctx.districts[D[id]] : null;
    return (d ? d.def.minorSep : 50) / (ctx.params ? ctx.params.density : 1);
  };

  const nearSame = (x, z, family, r, ownId) =>
    hashes[family].query(x, z, r, (p) => p.line !== ownId && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);

  function addLine(pts, family, level, meta = {}) {
    const id = lines.length;
    const L = ROAD_LEVELS[level];
    const line = { id, family, level, pts, width: L.width, sidewalk: L.sidewalk, ...meta };
    lines.push(line);
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (family >= 0) hashes[family].add(p.x, p.z, { x: p.x, z: p.z, line: id });
      allHash.add(p.x, p.z, { x: p.x, z: p.z, line: id, k });
    }
    return line;
  }

  // 한 방향 적분
  function integrate(sx, sz, family, level, sign, ownId, dsepFn) {
    const h = level === 1 ? 3 : 2.5;
    const maxLen = level === 1 ? 1400 : 520;
    let [dx, dz] = fieldDir(ctx, sx, sz, family);
    dx *= sign; dz *= sign;
    let x = sx, z = sz;
    const pts = [];
    const own = [];
    let len = 0, stop = 'length', bridge = false;
    for (let step = 0; step < maxLen / h; step++) {
      let [ax, az] = fieldDir(ctx, x, z, family);
      if (ax * dx + az * dz < 0) { ax = -ax; az = -az; }
      let [bx, bz] = fieldDir(ctx, x + ax * h * 0.5, z + az * h * 0.5, family);
      if (bx * ax + bz * az < 0) { bx = -bx; bz = -bz; }
      const nx = x + bx * h, nzz = z + bz * h;
      dx = bx; dz = bz;
      const id = cellId(nx, nzz);
      if (id < 0 || Math.abs(nx) > H - 14 || Math.abs(nzz) > H - 14) { stop = 'bounds'; break; }
      const t = T[id];
      if (t === TERRAIN.SEA) { stop = 'coast'; break; }
      if (t === TERRAIN.RIVER || t === TERRAIN.LAKE) {
        if (level !== 1) { stop = 'river'; break; }
        // 교량 규칙: 50m 이내에 건너편 육지가 있을 때만
        let k = 1, landAt = -1;
        for (; k * 2 <= 52; k++) {
          const q = cellId(x + bx * k * 2, z + bz * k * 2);
          if (q < 0) break;
          if (T[q] === TERRAIN.LAND) { landAt = k * 2; break; }
          if (T[q] === TERRAIN.SEA) break;
        }
        if (landAt < 0) { stop = 'river'; break; }
        const steps = Math.ceil((landAt + 4) / h);
        for (let s = 1; s <= steps; s++) {
          x += bx * h; z += bz * h;
          pts.push({ x, z, bridge: true });
        }
        bridge = true;
        len += steps * h;
        continue;
      }
      const zn = Z[id];
      if (zn !== ZONE.CITY) { stop = 'zone'; pts.push({ x: nx, z: nzz, zone: zn, zoneOwner: ctx.zoneOwner[id] }); break; }
      const dsep = dsepFn(nx, nzz);
      if (nearSame(nx, nzz, family, dsep * 0.5, ownId)) { stop = 'near'; break; }
      // 자기 루프
      let loop = false;
      for (let k = 0; k < own.length - 25; k += 2) {
        const p = own[k];
        if ((p.x - nx) ** 2 + (p.z - nzz) ** 2 < (dsep * 0.45) ** 2) { loop = true; break; }
      }
      if (loop) { stop = 'loop'; break; }
      x = nx; z = nzz;
      const pt = { x, z };
      pts.push(pt);
      own.push(pt);
      len += h;
    }
    return { pts, stop, len, bridge, dir: [dx, dz] };
  }

  function trace(sx, sz, family, level, dsepFn, meta) {
    const ownId = lines.length;
    const f = integrate(sx, sz, family, level, 1, ownId, dsepFn);
    const b = integrate(sx, sz, family, level, -1, ownId, dsepFn);
    const pts = b.pts.reverse().concat([{ x: sx, z: sz }], f.pts);
    const len = f.len + b.len;
    if (len < (level === 1 ? 50 : 22) || pts.length < 4) return null;
    return addLine(pts, family, level, {
      ...meta,
      ends: [
        { stop: b.stop, dir: [b.dir[0], b.dir[1]] },
        { stop: f.stop, dir: [f.dir[0], f.dir[1]] },
      ],
      bridge: f.bridge || b.bridge,
    });
  }

  const seedOk = (x, z) => {
    const id = cellId(x, z);
    return id >= 0 && T[id] === TERRAIN.LAND && Z[id] === ZONE.CITY && ctx.distSea[id] > 6;
  };

  function runLevel(level, initialSeeds, dsepFn, maxLines) {
    const queue = initialSeeds.slice();
    let qi = 0, made = 0;
    while (qi < queue.length && made < maxLines) {
      const s = queue[qi++];
      if (!seedOk(s.x, s.z)) continue;
      const dsep = dsepFn(s.x, s.z);
      if (nearSame(s.x, s.z, s.family, dsep * 0.85, -1)) continue;
      const line = trace(s.x, s.z, s.family, level, dsepFn, s.meta || {});
      if (!line) continue;
      made++;
      pushSeedsFrom(line, queue, dsepFn);
    }
    return made;
  }

  function pushSeedsFrom(line, queue, dsepFn) {
    let acc = 0;
    for (let k = 1; k < line.pts.length; k++) {
      const p = line.pts[k], q = line.pts[k - 1];
      acc += Math.hypot(p.x - q.x, p.z - q.z);
      const ds = dsepFn(p.x, p.z);
      if (acc < ds) continue;
      acc = 0;
      if (p.bridge) continue;
      queue.push({ x: p.x, z: p.z, family: 1 - line.family });
      const [dx, dz] = fieldDir(ctx, p.x, p.z, line.family);
      queue.push({ x: p.x - dz * ds, z: p.z + dx * ds, family: line.family });
      queue.push({ x: p.x + dz * ds, z: p.z - dx * ds, family: line.family });
    }
  }

  // ---- 레벨 1: 간선 ----
  const seeds1 = [];
  const spokes = 7;
  const spokeOff = rng.range(0, Math.PI * 2);
  for (let k = 0; k < spokes; k++) {
    const a = spokeOff + (k * Math.PI * 2) / spokes;
    seeds1.push({ x: Math.cos(a) * 82, z: Math.sin(a) * 82, family: 0, meta: { avenue: true } });
  }
  seeds1.push({ x: 150, z: 0, family: 1 }, { x: -150, z: 0, family: 1 });
  for (const d of ctx.districts) {
    if (d.type === 'center') continue;
    seeds1.push({ x: d.x, z: d.z, family: 0 }, { x: d.x, z: d.z, family: 1 });
  }
  const nMain = runLevel(1, seeds1, dsepMain, 120);

  // ---- 학원 진입대로: 정문 → 중앙탑 방향 직선, 기존 간선에 닿을 때까지 ----
  ctx.gates = [];
  for (const d of ctx.districts) {
    if (!d.def.campus || !d.core) continue;
    const ang = Math.atan2(-d.core.cz, -d.core.cx);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    let x = d.core.cx, z = d.core.cz;
    let inside = false;
    for (let s = 0; s < 400; s++) {
      const id = cellId(x, z);
      if (id < 0) break;
      if (Z[id] === ZONE.CAMPUS && ctx.zoneOwner[id] === d.id) inside = true;
      else if (inside) break;
      x += ux; z += uz;
    }
    const gate = { x, z, dir: [ux, uz], district: d.id, kind: 'main' };
    ctx.gates.push(gate);
    d.gate = gate;
    const pts = [{ x: x - ux * 2, z: z - uz * 2 }];
    let connected = false;
    for (let s = 1; s < 140; s++) {
      const px = x + ux * s * 3, pz = z + uz * s * 3;
      const id = cellId(px, pz);
      if (id < 0) break;
      if (T[id] === TERRAIN.SEA) break;
      if (Z[id] === ZONE.PLAZA) { pts.push({ x: px, z: pz }); connected = true; break; }
      if (Z[id] !== ZONE.CITY) break;
      const isBridge = T[id] !== TERRAIN.LAND;
      pts.push({ x: px, z: pz, bridge: isBridge || undefined });
      const hit = s > 3 && allHash.query(px, pz, 6, (p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < 36 && lines[p.line].level === 1);
      if (hit) { connected = true; break; }
    }
    if (pts.length >= 3) {
      const line = addLine(pts, -1, 1, { approach: d.id, ends: [{ stop: 'zone' }, { stop: connected ? 'joined' : 'length' }] });
      line.bridge = pts.some((p) => p.bridge);
      ctx.log('macro.approach', `${d.name} 정문 진입대로 ${(pts.length * 3).toFixed(0)}m`);
    }
  }

  // ---- 해안도로: distSea = 13m 등거리선 추종 ----
  traceCoastRoad(ctx, addLine);

  // ---- 레벨 2: 생활가로 ----
  const seeds2 = [];
  for (const line of lines.slice()) {
    let acc = 0;
    for (let k = 1; k < line.pts.length; k++) {
      const p = line.pts[k], q = line.pts[k - 1];
      acc += Math.hypot(p.x - q.x, p.z - q.z);
      const ds = dsepMinor(p.x, p.z);
      if (acc < ds) continue;
      acc = 0;
      if (p.bridge) continue;
      const fam = line.family >= 0 ? line.family : 0;
      seeds2.push({ x: p.x, z: p.z, family: 1 - fam });
      seeds2.push({ x: p.x, z: p.z, family: fam });
    }
  }
  rng.shuffle(seeds2);
  const nMinor = runLevel(2, seeds2, dsepMinor, 2200);

  // ---- 끝점 연결 (Chen: dangling 연장) ----
  connectEnds(ctx, lines, allHash, dsepMain, dsepMinor);
  ctx.log('macro.tensor', `간선 ${nMain}개, 생활가로 ${nMinor}개 유선`);
}

function traceCoastRoad(ctx, addLine) {
  const ISO = 13;
  const DS = ctx.distSea, T = ctx.terrain.data;
  const samp = (x, z) => {
    const fx = x + H - 0.5, fz = z + H - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fx))), j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const tx = fx - i, tz = fz - j;
    const a = DS[j * N + i], b = DS[j * N + i + 1], c = DS[(j + 1) * N + i], d = DS[(j + 1) * N + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  // 시작점: 만의 반대편에서 바다 쪽으로 진행하며 ISO 지점 탐색
  const a0 = ctx.bayAngle + Math.PI;
  let sx = 0, sz = 0, found = false;
  for (let r = 300; r < 505; r += 1) {
    const x = Math.cos(a0) * r, z = Math.sin(a0) * r;
    const id = cellId(x, z);
    if (id < 0) break;
    if (T[id] === TERRAIN.LAND && Math.abs(DS[id] - ISO) < 1.2) { sx = x; sz = z; found = true; break; }
  }
  if (!found) return;
  const pts = [];
  let x = sx, z = sz, dirx = 0, dirz = 0;
  const h = 3;
  for (let s = 0; s < 1600; s++) {
    const gx = samp(x + 2, z) - samp(x - 2, z), gz = samp(x, z + 2) - samp(x, z - 2);
    const gl = Math.hypot(gx, gz) || 1;
    let tx = -gz / gl, tz = gx / gl;
    if (s === 0) { dirx = tx; dirz = tz; }
    if (tx * dirx + tz * dirz < 0) { tx = -tx; tz = -tz; }
    const corr = 0.12 * (ISO - samp(x, z));
    let mx = tx + (gx / gl) * corr, mz = tz + (gz / gl) * corr;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    dirx = mx * 0.6 + dirx * 0.4; dirz = mz * 0.6 + dirz * 0.4;
    const dl = Math.hypot(dirx, dirz) || 1;
    dirx /= dl; dirz /= dl;
    x += dirx * h; z += dirz * h;
    if (Math.abs(x) > H - 10 || Math.abs(z) > H - 10) break;
    const id = cellId(x, z);
    const bridge = T[id] !== TERRAIN.LAND;
    pts.push({ x, z, bridge: bridge || undefined });
    if (s > 60 && Math.hypot(x - sx, z - sz) < 6) break;
  }
  if (pts.length > 30) {
    // 바다로 너무 들어간 연속 구간(>60m)은 잘라낸다
    const line = addLine(pts, -1, 4, { coast: true, ends: [{ stop: 'loop' }, { stop: 'loop' }] });
    line.bridge = pts.some((p) => p.bridge);
    ctx.log('macro.coast', `해안도로 ${(pts.length * h).toFixed(0)}m`);
  }
}

function connectEnds(ctx, lines, allHash, dsepMain, dsepMinor) {
  const T = ctx.terrain.data, Z = ctx.zone.data;
  ctx.deadEnds = [];
  ctx.zoneEntrances = [];
  for (const line of lines) {
    if (!line.ends) continue;
    for (let e = 0; e < 2; e++) {
      const end = line.ends[e];
      const p = e === 0 ? line.pts[0] : line.pts[line.pts.length - 1];
      const q = e === 0 ? line.pts[Math.min(2, line.pts.length - 1)] : line.pts[Math.max(0, line.pts.length - 3)];
      let dx = p.x - q.x, dz = p.z - q.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      if (end.stop === 'zone') {
        ctx.zoneEntrances.push({ x: p.x, z: p.z, dir: [dx, dz], line: line.id, level: line.level, zone: p.zone, owner: p.zoneOwner });
        continue;
      }
      if (end.stop === 'coast' || end.stop === 'joined' || end.stop === 'bounds') continue;
      // 이미 다른 선에 닿아 있나?
      const touching = allHash.query(p.x, p.z, 7, (o) => o.line !== line.id && (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 49);
      if (touching) continue;
      const ext = (line.level === 1 ? dsepMain(p.x, p.z) : dsepMinor(p.x, p.z)) * 0.8;
      let joined = null;
      const added = [];
      for (let s = 2; s <= ext; s += 2) {
        const x = p.x + dx * s, z = p.z + dz * s;
        const id = cellId(x, z);
        if (id < 0 || T[id] !== TERRAIN.LAND || Z[id] !== ZONE.CITY) break;
        added.push({ x, z });
        let best = null, bd = 25;
        allHash.query(x, z, 5, (o) => {
          if (o.line === line.id) return false;
          const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
          if (d2 < bd) { bd = d2; best = o; }
          return false;
        });
        if (best) { joined = best; break; }
      }
      if (joined) {
        added.push({ x: joined.x, z: joined.z });
        if (e === 0) line.pts.unshift(...added.reverse());
        else line.pts.push(...added);
        for (const a of added) allHash.add(a.x, a.z, { x: a.x, z: a.z, line: line.id });
        end.stop = 'joined';
      } else if (end.stop === 'river') {
        ctx.deadEnds.push({ x: p.x, z: p.z, dir: [dx, dz], line: line.id, level: line.level, kind: 'riverside' });
      } else {
        ctx.deadEnds.push({ x: p.x, z: p.z, dir: [dx, dz], line: line.id, level: line.level, kind: 'street' });
      }
    }
  }
}

// ---- 래스터화: 도로/보도 ----
export function rasterizeRoads(ctx) {
  const road = ctx.road || new Grid(N, N, 1, -H, -H, Uint8Array);
  const pri = new Uint8Array(N * N);
  const R = road.data;
  R.fill(0);
  const T = ctx.terrain.data, Z = ctx.zone.data;
  const PRI = { 1: 5, 4: 4, 2: 3, 3: 2 };
  for (const line of ctx.roadLines) {
    if (line.removed) continue;
    const hw = line.width / 2, sw = line.sidewalk;
    const outer = hw + sw;
    const type = ROAD_LEVELS[line.level].type;
    const p0 = PRI[line.level];
    const canBridge = line.level === 1 || line.level === 4;
    for (let k = 0; k < line.pts.length - 1; k++) {
      const a = line.pts[k], b = line.pts[k + 1];
      const i0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - outer + H)), i1 = Math.min(N - 1, Math.ceil(Math.max(a.x, b.x) + outer + H));
      const j0 = Math.max(0, Math.floor(Math.min(a.z, b.z) - outer + H)), j1 = Math.min(N - 1, Math.ceil(Math.max(a.z, b.z) + outer + H));
      for (let j = j0; j <= j1; j++) {
        const z = j - H + 0.5;
        for (let i = i0; i <= i1; i++) {
          const x = i - H + 0.5;
          const id = j * N + i;
          const t = T[id];
          if (t === TERRAIN.SEA && !(canBridge && (a.bridge || b.bridge))) continue;
          const d2 = segDist2(x, z, a.x, a.z, b.x, b.z);
          if (d2 > outer * outer) continue;
          const water = t !== TERRAIN.LAND;
          if (water && !canBridge) continue;
          if (Z[id] === ZONE.PLAZA) continue;
          if (d2 <= hw * hw) {
            if (p0 > pri[id]) {
              R[id] = water ? ROAD.BRIDGE : type;
              pri[id] = p0;
            }
          } else if (pri[id] === 0 && !water) {
            R[id] = ROAD.SIDEWALK;
            pri[id] = 1;
          } else if (pri[id] === 0 && water && (a.bridge || b.bridge)) {
            R[id] = ROAD.BRIDGE; // 교량 보도
            pri[id] = 1;
          }
        }
      }
    }
  }
  for (let id = 0; id < N * N; id++) {
    if (Z[id] === ZONE.PLAZA) R[id] = ROAD.PLAZA;
    else if (R[id] && Z[id] !== ZONE.CITY) Z[id] = ZONE.CITY; // 도로가 덮은 존 가장자리는 도시로
  }
  ctx.road = road;
}

/** 교차점(Node) 계산: 서로 다른 선의 세그먼트 교차 + 클러스터링 */
export function computeNodes(ctx) {
  const lines = ctx.roadLines.filter((l) => !l.removed);
  const segHash = new Map();
  const B = 24;
  const key = (i, j) => ((i + 512) << 11) | (j + 512);
  for (const l of lines) {
    for (let k = 0; k < l.pts.length - 1; k++) {
      const a = l.pts[k], b = l.pts[k + 1];
      const i0 = Math.floor(Math.min(a.x, b.x) / B), i1 = Math.floor(Math.max(a.x, b.x) / B);
      const j0 = Math.floor(Math.min(a.z, b.z) / B), j1 = Math.floor(Math.max(a.z, b.z) / B);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const kk = key(i, j);
        let arr = segHash.get(kk);
        if (!arr) segHash.set(kk, (arr = []));
        arr.push([l, k]);
      }
    }
  }
  const raw = [];
  for (const arr of segHash.values()) {
    for (let m = 0; m < arr.length; m++) {
      for (let n = m + 1; n < arr.length; n++) {
        const [l1, k1] = arr[m], [l2, k2] = arr[n];
        if (l1 === l2) continue;
        const a = l1.pts[k1], b = l1.pts[k1 + 1], c = l2.pts[k2], d = l2.pts[k2 + 1];
        // 끝 세그먼트는 살짝 연장해 T자 접합도 잡는다
        const ext = 1.5;
        const ex = (p, q, isEnd) => {
          if (!isEnd) return p;
          const dx = p.x - q.x, dz = p.z - q.z, L = Math.hypot(dx, dz) || 1;
          return { x: p.x + (dx / L) * ext, z: p.z + (dz / L) * ext };
        };
        const A2 = ex(a, b, k1 === 0), B2 = ex(b, a, k1 === l1.pts.length - 2);
        const C2 = ex(c, d, k2 === 0), D2 = ex(d, c, k2 === l2.pts.length - 2);
        const hit = segIntersect(A2.x, A2.z, B2.x, B2.z, C2.x, C2.z, D2.x, D2.z);
        if (hit) raw.push({ x: hit.x, z: hit.z, l1, l2 });
      }
    }
  }
  // 클러스터링 (10m)
  const nodes = [];
  for (const r of raw) {
    let node = null;
    for (const n of nodes) if ((n.x - r.x) ** 2 + (n.z - r.z) ** 2 < 100) { node = n; break; }
    if (!node) {
      node = { id: nodes.length, x: r.x, z: r.z, lines: new Set(), n: 0 };
      nodes.push(node);
    }
    node.lines.add(r.l1.id);
    node.lines.add(r.l2.id);
  }
  for (const n of nodes) {
    const ls = [...n.lines].map((id) => ctx.roadLines[id]);
    n.level = Math.min(...ls.map((l) => (l.level === 4 ? 1.5 : l.level)));
    n.mainCount = ls.filter((l) => l.level === 1).length;
    n.lines = [...n.lines];
    const id = cellId(n.x, n.z);
    n.district = id >= 0 ? ctx.district.data[id] : 255;
  }
  ctx.nodes = nodes;
}
