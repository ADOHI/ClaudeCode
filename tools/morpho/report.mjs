// Morphometric report for a bust-bind/1 export over named slider states.
//   node tools/morpho/report.mjs <bind.json> [--selection outer|skin|all]
//        [--states base,size_up_natural,...] [--json out.json] [--sides]
// Prints a markdown table (metrics x states, mean of both sides) with the
// distance to the natural / anime bands (imfRise relative to `base`).
import fs from 'node:fs';
import { measurePrepared, scoreBands, METRICS, BANDS } from '../../web/src/core/morpho.js';
import { loadBind, prepareBind, stateWeights, STATES } from './bindio.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) {
  console.error('usage: node tools/morpho/report.mjs <bind.json> [--selection outer|skin|all] [--states a,b] [--json out.json] [--sides]');
  process.exit(1);
}
const selection = opt('selection', 'outer');
const states = opt('states', Object.keys(STATES).slice(0, 6).join(',')).split(',');

const t0 = performance.now();
const bind = loadBind(file);
const prep = prepareBind(bind, { selection });
const tPrep = performance.now() - t0;
const results = {};
for (const s of states) {
  const t1 = performance.now();
  results[s] = measurePrepared(prep.ctx, stateWeights(s));
  results[s].ms = performance.now() - t1;
}
const ref = results.base?.mean ?? null;

const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Number(v).toFixed(d));
const lines = [];
lines.push(`selection \`${selection}\`: ${prep.triangles} triangles selected, ${prep.ctx.tris.length / 3} near the bust; anchor ${JSON.stringify(prep.params.anchor)}; prepare ${tPrep.toFixed(0)} ms`);
lines.push('');
lines.push(`| metric | ${states.join(' | ')} |`);
lines.push(`|---|${states.map(() => '---:').join('|')}|`);
for (const { key, label, unit, pct } of METRICS) {
  lines.push(`| ${label}${unit ? ` (${unit})` : ''} | ${states.map((s) => { const v = results[s].mean[key]; return pct && v != null ? fmt(v * 100, 1) : fmt(v, key.endsWith('Deg') ? 1 : 3); }).join(' | ')} |`);
}
lines.push(`| upper pole shape | ${states.map((s) => results[s].mean.upperShape ?? '-').join(' | ')} |`);
for (const [bk, band] of Object.entries(BANDS)) {
  lines.push(`| dist. to ${bk} band | ${states.map((s) => fmt(scoreBands(results[s].mean, band, { reference: ref }).distance, 2)).join(' | ')} |`);
}
lines.push(`| measure ms | ${states.map((s) => fmt(results[s].ms, 1)).join(' | ')} |`);
lines.push('');
for (const s of states) {
  const f = results[s].mean.flags;
  if (f.length) lines.push(`- ${s}: flags ${f.join(', ')}`);
}
if (args.includes('--sides')) {
  lines.push('');
  for (const s of states) for (const r of results[s].sides) lines.push(`- ${s} ${r.side}: ${METRICS.map(({ key }) => `${key}=${fmt(r[key], 4)}`).join(' ')}`);
}
console.log(lines.join('\n'));
const jsonOut = opt('json', null);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ file, selection, params: prep.params, results }, null, 1));
