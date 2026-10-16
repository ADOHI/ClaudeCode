// 견고성 스윕: 여러 시드/파라미터로 생성해 예외·지표 이상치를 확인
import { generateSync } from '../src/core/generator.js';
const seeds = ['sakura-101', 'halo-7', 'aurora-42', 'kivo-999', 'nova-3', 'iris-55', 'hikari-808', 'yume-12', 'a', 'Z'];
const dens = [0.85, 1, 1.2];
let fail = 0;
for (let i = 0; i < seeds.length; i++) {
  const s = seeds[i], d = dens[i % 3];
  try {
    const t = Date.now();
    const c = generateSync(s, null, { density: d });
    const m = c.metrics;
    const bad = [];
    if (m.poiCoverage < 0.95) bad.push('coverage');
    if (m.landmarkVisible < 0.85) bad.push('landmark');
    if (m.deadEndCoverage < 1) bad.push('deadend');
    if (m.secrets < 40) bad.push('secrets');
    if (m.buildings < 400) bad.push('buildings');
    console.log(`${s.padEnd(11)} d=${d} ${Date.now() - t}ms score=${m.score} bld=${m.buildings} sec=${m.secrets} cov=${m.poiCoverage.toFixed(2)} lm=${m.landmarkVisible.toFixed(2)} roof=${m.rooftopRoutes} gates=${m.gates} lmk=${m.landmarks} ${bad.length ? '⚠ ' + bad.join(',') : ''}`);
  } catch (e) {
    fail++;
    console.log(`${s} FAILED: ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
  }
}
console.log(fail ? `${fail} failures` : 'all ok');
