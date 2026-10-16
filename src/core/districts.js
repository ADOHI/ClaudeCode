// 매크로 2단계: 구역(District) 배치 — 포아송 시드, 로이드 완화, 제약 점수 최적화, 왜곡 보로노이.
import { Noise2D } from './rng.js';
import { Grid, edt, components, angleWrap } from './grid.js';
import { TERRAIN, ZONE, WORLD, DISTRICT_TYPES, CITY_PROGRAM } from './config.js';

const WADD = { center: -40, park: 18, harbor: 10, trad_academy: 22, tech_academy: 22, free_academy: 18, arts_academy: 22 };

export function genDistricts(ctx) {
  const rng = ctx.rng.fork('districts');
  const N = WORLD.size, H = WORLD.half;
  const T = ctx.terrain.data;
  const at = (x, z) => {
    const i = Math.floor(x + H), j = Math.floor(z + H);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  };
  const count = CITY_PROGRAM.length;

  // 1) 시드: 중심 고정 + 다트 던지기 포아송
  let seeds = [];
  let rmin = 175;
  for (let attempt = 0; attempt < 12 && seeds.length < count; attempt++) {
    seeds = [{ x: 0, z: 0 }];
    for (let t = 0; t < 4000 && seeds.length < count; t++) {
      const x = rng.range(-420, 420), z = rng.range(-420, 420);
      const id = at(x, z);
      if (id < 0 || T[id] !== TERRAIN.LAND) continue;
      if (ctx.distSea[id] < 30 || ctx.distRiver[id] < 25) continue;
      if (Math.hypot(x, z) < 170) continue;
      let ok = true;
      for (const s of seeds) if (Math.hypot(s.x - x, s.z - z) < rmin) { ok = false; break; }
      if (ok) seeds.push({ x, z });
    }
    rmin *= 0.92;
  }

  // 2) 로이드 완화 (8m 샘플)
  for (let it = 0; it < 3; it++) {
    const acc = seeds.map(() => ({ x: 0, z: 0, n: 0 }));
    for (let z = -H + 4; z < H; z += 8) {
      for (let x = -H + 4; x < H; x += 8) {
        const id = at(x, z);
        if (T[id] !== TERRAIN.LAND) continue;
        let best = 0, bd = Infinity;
        for (let s = 0; s < seeds.length; s++) {
          const d = Math.hypot(seeds[s].x - x, seeds[s].z - z);
          if (d < bd) { bd = d; best = s; }
        }
        acc[best].x += x; acc[best].z += z; acc[best].n++;
      }
    }
    for (let s = 1; s < seeds.length; s++) {
      if (acc[s].n === 0) continue;
      const cx = acc[s].x / acc[s].n, cz = acc[s].z / acc[s].n;
      const nx = seeds[s].x * 0.3 + cx * 0.7, nzv = seeds[s].z * 0.3 + cz * 0.7;
      const id = at(nx, nzv);
      if (id >= 0 && T[id] === TERRAIN.LAND && ctx.distRiver[id] > 15) { seeds[s].x = nx; seeds[s].z = nzv; }
    }
  }

  // 3) 시드 특징
  const feats = seeds.map((s) => {
    const id = at(s.x, s.z);
    return {
      r: Math.hypot(s.x, s.z) / 440,
      coast: ctx.distSea[id],
      river: ctx.distRiver[id],
      ang: Math.atan2(s.z, s.x),
    };
  });

  // 4) 유형 배정: 단항 선호 + 쌍대 제약 점수를 언덕오르기로 최대화
  const types = CITY_PROGRAM.slice(1); // center는 시드 0 고정
  const score = (assign) => {
    // assign[k] = seeds[k+1]의 유형
    let sc = 0;
    const pos = {};
    for (let k = 0; k < assign.length; k++) {
      const t = assign[k], f = feats[k + 1], D = DISTRICT_TYPES[t];
      sc -= 3 * Math.abs(f.r - D.pref.r);
      if (D.pref.coast) sc -= (2.5 * f.coast) / 80;
      if (D.pref.river) sc -= (1.5 * f.river) / 100;
      (pos[t] = pos[t] || []).push(seeds[k + 1]);
    }
    const acad = ['trad_academy', 'tech_academy', 'free_academy', 'arts_academy'].map((t) => pos[t][0]);
    for (let a = 0; a < acad.length; a++) {
      for (let b = a + 1; b < acad.length; b++) {
        const da = Math.abs(angleWrap(Math.atan2(acad[a].z, acad[a].x) - Math.atan2(acad[b].z, acad[b].x)));
        sc += 0.7 * (da / Math.PI);
      }
    }
    const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
    sc -= dist(pos.free_academy[0], pos.ruins[0]) / 300; // 무법 학원은 폐허 옆
    sc -= Math.abs(dist(pos.free_academy[0], pos.trad_academy[0]) - 280) / 220; // 라이벌은 국경을 맞댄다
    sc += 0.5 * Math.min(dist(pos.commercial[0], pos.commercial[1]), 400) / 400;
    for (const r of pos.residential) sc -= (0.4 * Math.min(...acad.map((a) => dist(a, r)))) / 400;
    return sc;
  };
  let assign = rng.shuffle(types.slice());
  let cur = score(assign);
  for (let it = 0; it < 2500; it++) {
    const a = rng.int(0, assign.length - 1), b = rng.int(0, assign.length - 1);
    if (a === b || assign[a] === assign[b]) continue;
    [assign[a], assign[b]] = [assign[b], assign[a]];
    const s = score(assign);
    const temp = 0.25 * (1 - it / 2500);
    if (s >= cur || rng.next() < Math.exp((s - cur) / Math.max(1e-3, temp))) cur = s;
    else [assign[a], assign[b]] = [assign[b], assign[a]];
  }

  const districts = seeds.map((s, k) => {
    const type = k === 0 ? 'center' : assign[k - 1];
    const D = DISTRICT_TYPES[type];
    return { id: k, type, name: D.name, x: s.x, z: s.z, color: D.ground, accent: D.accent, def: D, area: 0 };
  });
  // 같은 유형이 둘 이상이면 방위로 이름 구분 (북 = -z)
  const dirOf = (d) => {
    const a = Math.atan2(d.z, d.x);
    return Math.abs(a) < Math.PI / 4 ? '동' : Math.abs(a) > (3 * Math.PI) / 4 ? '서' : a > 0 ? '남' : '북';
  };
  const byType = {};
  for (const d of districts) (byType[d.type] = byType[d.type] || []).push(d);
  for (const list of Object.values(byType)) {
    if (list.length < 2) continue;
    const names = list.map((d) => `${d.def.name} ${dirOf(d)}부`);
    list.forEach((d, i) => {
      d.name = names.filter((n) => n === names[i]).length > 1 ? `${names[i]} ${i + 1}` : names[i];
    });
  }

  // 5) 왜곡된 가중 보로노이 래스터 (1m)
  const nz = new Noise2D(rng.fork('warp'));
  const warpX = new Grid(N / 8 + 2, N / 8 + 2, 8, -H - 8, -H - 8);
  const warpZ = new Grid(N / 8 + 2, N / 8 + 2, 8, -H - 8, -H - 8);
  for (let j = 0; j < warpX.h; j++) {
    for (let i = 0; i < warpX.w; i++) {
      const x = warpX.cx(i), z = warpX.cz(j);
      warpX.data[j * warpX.w + i] = 34 * nz.fbm(x / 180, z / 180, 3);
      warpZ.data[j * warpX.w + i] = 34 * nz.fbm(x / 180 + 37.1, z / 180 - 12.7, 3);
    }
  }
  const dgrid = new Grid(N, N, 1, -H, -H, Uint8Array);
  const D = dgrid.data;
  const wadd = districts.map((d) => WADD[d.type] || 0);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const id = j * N + i;
      if (T[id] === TERRAIN.SEA) { D[id] = 255; continue; }
      const x0 = dgrid.cx(i), z0 = dgrid.cz(j);
      const x = x0 + warpX.bilinear(x0, z0), z = z0 + warpZ.bilinear(x0, z0);
      let best = 0, bd = Infinity;
      for (let s = 0; s < districts.length; s++) {
        const d = Math.hypot(districts[s].x - x, districts[s].z - z) - wadd[s];
        if (d < bd) { bd = d; best = s; }
      }
      D[id] = best;
      districts[best].area++;
    }
  }
  ctx.district = dgrid;
  ctx.districts = districts;

  // 경계까지 거리
  ctx.distBorder = edt((id) => {
    const v = D[id];
    if (v === 255) return true;
    const i = id % N, j = (id / N) | 0;
    if (i > 0 && D[id - 1] !== v) return true;
    if (i < N - 1 && D[id + 1] !== v) return true;
    if (j > 0 && D[id - N] !== v) return true;
    if (j < N - 1 && D[id + N] !== v) return true;
    return false;
  }, N, N);

  genZones(ctx);
  ctx.log('macro.district', `시드 ${seeds.length}개, 배정 점수 ${cur.toFixed(2)}`);
}

function genZones(ctx) {
  const N = WORLD.size, H = WORLD.half;
  const zone = new Grid(N, N, 1, -H, -H, Uint8Array);
  const Z = zone.data, D = ctx.district.data, T = ctx.terrain.data;
  const owner = new Int16Array(N * N).fill(-1);
  for (const d of ctx.districts) {
    const def = d.def;
    if (!def.campus && !def.park) continue;
    const margin = def.campus ? 18 : 12;
    // 캠퍼스는 구역 전체가 아니라 반경 ~100m의 '담장 안'만. 나머지 띠는 학원가(일반 도시 블록)
    const Rc = def.campus ? (d.type === 'free_academy' ? 92 : 104) : 1e9;
    const mask = (id) => {
      if (D[id] !== d.id || T[id] !== TERRAIN.LAND || ctx.distBorder[id] <= margin || ctx.distSea[id] <= 24 || ctx.distRiver[id] <= 8) return false;
      if (Rc > 1e8) return true;
      const x = (id % N) - H + 0.5 - d.x, z = ((id / N) | 0) - H + 0.5 - d.z;
      const a = Math.atan2(z, x);
      return Math.hypot(x, z) < Rc * (1 + 0.1 * Math.sin(3 * a + d.id) + 0.06 * Math.cos(5 * a));
    };
    const comp = components(N, N, mask);
    if (comp.count === 0) continue;
    let best = 0;
    for (let c = 1; c < comp.count; c++) if (comp.sizes[c] > comp.sizes[best]) best = c;
    let sx = 0, sz = 0, n = 0;
    for (let id = 0; id < N * N; id++) {
      if (comp.labels[id] === best) {
        Z[id] = def.campus ? ZONE.CAMPUS : ZONE.PARK;
        owner[id] = d.id;
        sx += id % N; sz += (id / N) | 0; n++;
      }
    }
    d.core = { cx: sx / n - H + 0.5, cz: sz / n - H + 0.5, area: n };
  }
  // 중앙 광장
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - H + 0.5, z = j - H + 0.5;
      if (x * x + z * z < 62 * 62) Z[j * N + i] = ZONE.PLAZA;
    }
  }
  ctx.zone = zone;
  ctx.zoneOwner = owner;
}
