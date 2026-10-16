// 품질 다양성 탐색 (MAP-Elites).
// 유전자 = { seed, density(가로 밀도 배율), alleys(골목 확률 배율) }
// 행동 기술자 = 도로 연장(km) × 숨김 공간 비율 → 칸마다 종합 점수 최고 개체를 보관하고, 엘리트를 변이시켜 탐색.
// 사용: node tools/seed-search.mjs [평가 횟수=24] [접두사=city]
import { generateSync } from '../src/core/generator.js';
import { RNG } from '../src/core/rng.js';

const EVALS = +(process.argv[2] || 24);
const prefix = process.argv[3] || 'city';
const BINS_X = [17, 19, 21, 23, 25, 999];
const BINS_Y = [0.38, 0.42, 0.46, 0.5, 1];
const binOf = (v, edges) => edges.findIndex((e) => v < e);
const rng = new RNG(`search:${prefix}`);
const archive = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let n = 0;

function evaluate(g) {
  const t = Date.now();
  const ctx = generateSync(g.seed, null, { density: g.density, alleys: g.alleys });
  const m = ctx.metrics;
  const key = `${binOf(m.bdRoadDensity, BINS_X)},${binOf(m.bdHiddenRatio, BINS_Y)}`;
  const cur = archive.get(key);
  const isNew = !cur || cur.score < m.score;
  if (isNew) archive.set(key, { ...g, score: m.score, road: m.bdRoadDensity, hidden: m.bdHiddenRatio, secrets: m.secrets });
  console.log(`${String(++n).padStart(3)} ${g.seed.padEnd(11)} d=${g.density.toFixed(2)} a=${g.alleys.toFixed(2)} → score ${m.score.toFixed(3)} road ${m.bdRoadDensity.toFixed(1)}km hidden ${m.bdHiddenRatio.toFixed(2)} ${isNew ? '★ ' + key : ''} (${Date.now() - t}ms)`);
}

const INIT = Math.max(4, Math.floor(EVALS / 3));
for (let i = 0; i < INIT; i++) evaluate({ seed: `${prefix}-${i}`, density: rng.range(0.8, 1.3), alleys: rng.range(0.5, 1.6) });
for (let i = INIT; i < EVALS; i++) {
  const elites = [...archive.values()];
  const p = rng.pick(elites);
  // 변이: 파라미터 가우스 섭동 + 확률적으로 시드 교체
  evaluate({
    seed: rng.chance(0.5) ? `${prefix}-${i}` : p.seed,
    density: clamp(p.density + rng.gauss() * 0.12, 0.7, 1.45),
    alleys: clamp(p.alleys + rng.gauss() * 0.25, 0.3, 2),
  });
}
console.log('\nMAP-Elites 아카이브 (행: 숨김 비율, 열: 도로 연장 km)');
console.log(['hidden\\road', ...BINS_X.map((e) => `<${e === 999 ? '∞' : e}`)].map((h) => h.padEnd(20)).join(''));
for (let y = 0; y < BINS_Y.length; y++) {
  const line = [`<${BINS_Y[y]}`.padEnd(20)];
  for (let x = 0; x < BINS_X.length; x++) {
    const c = archive.get(`${x},${y}`);
    line.push((c ? `${c.seed}/${c.density.toFixed(2)}:${c.score.toFixed(2)}` : '·').padEnd(20));
  }
  console.log(line.join(''));
}
const best = [...archive.values()].sort((a, b) => b.score - a.score)[0];
console.log(`\n채워진 칸 ${archive.size}/${BINS_X.length * BINS_Y.length} · 최고: ${best.seed} density=${best.density.toFixed(2)} alleys=${best.alleys.toFixed(2)} score=${best.score}`);
