// Tier 1 garment check on a bind-space export (bust-bind/1).
//   node scripts/garment-check.mjs <bind.json> <preset|config.json> [--opts '{"thickness":0.01}'] [--svg out.svg] [--json out.json]
// e.g. node scripts/garment-check.mjs .cache/changli.bind.json changli --svg /tmp/x/changli-slice.svg
// Prints the cling map, bridge-vs-apex numbers and clearance over every slider
// corner x w in {.25,.5,.75,1}, for the corrected deltas and the field alone.
// The SVG is a horizontal slice at apex height (body, garment rest / field /
// corrected) for a qualitative look; write it outside the repo.
import fs from 'node:fs';
import { createBustField } from '../src/core/field.js';
import { extremeCombos } from '../src/core/validate.js';
import { decodeBind, bakeGarments, gapCheck, bridgeFollow, garmentCombos, SPLIT_PRESETS, CLASS_NAMES } from '../src/core/garment.js';

const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const opts = JSON.parse(flag('--opts') ?? '{}');
const svgOut = flag('--svg');
const jsonOut = flag('--json');
const [file, cfgArg] = args;
if (!file || !cfgArg) {
  console.error('usage: node scripts/garment-check.mjs <bind.json> <preset|config.json> [--opts json] [--svg out.svg] [--json out.json]');
  process.exit(1);
}
const config = SPLIT_PRESETS[cfgArg] ?? JSON.parse(fs.readFileSync(cfgArg, 'utf8'));
const bind = JSON.parse(fs.readFileSync(file, 'utf8'));
const meshes = decodeBind(bind);
const field = createBustField(bind.frame, bind.params);
const S = field.S;
const fmt = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

const t0 = performance.now();
const res = bakeGarments(meshes, field, config, opts);
console.log(`bake ${(performance.now() - t0).toFixed(0)} ms, body welded ${res.body.n} verts / ${res.body.tri.length / 3} tris, S=${fmt(S)}`);
const report = { file, config: cfgArg, opts, S, garments: [] };

for (const g of res.garments) {
  if (g.empty || g.inactive) {
    console.log(`\n[${g.name}] ${g.empty ? 'no triangles selected' : 'outside the field support (no deltas)'}`);
    report.garments.push({ name: g.name, empty: !!g.empty, inactive: !!g.inactive });
    continue;
  }
  const m = g.model;
  console.log(`\n[${g.name}] ${(g.ms / 1000).toFixed(1)} s  ${JSON.stringify(m.stats)}`);
  const rows = [];
  for (const t of res.targets) {
    const c = bridgeFollow(m, field, g.deltas, t), f = bridgeFollow(m, field, m.uField, t);
    const info = g.info[t];
    rows.push({ t, c, f, info });
    console.log(
      `  ${t.padEnd(22)} apexFwd ${fmt(c.apexForward)}S | bridge n=${c.count} fwd ${fmt(c.bridgeForward)}S: /apex corr ${fmt(c.ratio, 3)} field ${fmt(f.ratio, 3)}` +
        ` | /support(n=${c.supports}) corr ${fmt(c.supportRatio, 3)} field ${fmt(f.supportRatio, 3)}` +
        ` | changed ${g.output.targets[t].changed}, pushed ${info.pushed}, maxPush ${fmt(info.maxPush / S)}S, cg ${info.cgIterations} it`,
    );
  }
  console.log(`  blend fix: ${JSON.stringify(g.info.blend)}`);
  const t1 = performance.now();
  const gc = gapCheck(m, res.body, res.bodyDeltas, g.deltas);
  const gf = gapCheck(m, res.body, res.bodyDeltas, m.uField);
  const ge = gapCheck(m, res.body, res.bodyDeltas, g.deltas, { combos: extremeCombos() });
  const show = (name, r) =>
    console.log(
      `  gap ${name.padEnd(9)} configs ${r.configs}, checked ${r.checked}: minGap ${fmt(r.minGap)}S (thickness ${r.thickness}), minSlack ${fmt(r.minSlack)}S, violations ${r.violations} in ${r.violatingConfigs} configs` +
        ` | per w ${Object.entries(r.perW).map(([w, p]) => `${w}:${fmt(p.minGap)}/${p.violations}`).join(' ')}` +
        (r.worst && r.violations ? ` | worst ${JSON.stringify(r.worst)}` : ''),
    );
  show('corrected', gc);
  show('extremes', ge);
  show('field', gf);
  console.log(`  checks ${((performance.now() - t1) / 1000).toFixed(1)} s (${garmentCombos().length} slider corners)`);
  report.garments.push({ name: g.name, stats: m.stats, info: g.info, bridge: rows.map(({ t, c, f }) => ({ t, corr: c, field: f })), gapCorrected: gc, gapExtremes: ge, gapField: gf });
  if (svgOut && g === res.garments.find((x) => x.model && !x.inactive)) writeSlice(svgOut, res, g, 'bust_size_up_stylized');
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));

// Horizontal slice through the apex (body frame y = apex y): triangle/plane
// intersection segments in body-frame (x, z), S units.
function writeSlice(out, res, g, t) {
  const f = field.frame;
  const apex = field.sides[0].apex;
  const y0 = dot3(sub3(apex, f.origin), f.up);
  const segs = (P, tri) => {
    const s = [];
    for (let k = 0; k < tri.length; k += 3) {
      const pts = [];
      const ys = [0, 1, 2].map((c) => dot3(sub3(at(P, tri[k + c]), f.origin), f.up) - y0);
      for (let e = 0; e < 3; e++) {
        const a = tri[k + e], b = tri[k + ((e + 1) % 3)], ya = ys[e], yb = ys[(e + 1) % 3];
        if ((ya < 0) === (yb < 0)) continue;
        const u = ya / (ya - yb);
        const p = at(P, a).map((v, i) => v + u * (at(P, b)[i] - v));
        const d = sub3(p, f.origin);
        pts.push([dot3(d, f.left) / S, dot3(d, f.forward) / S]);
      }
      if (pts.length === 2) s.push(pts);
    }
    return s;
  };
  const m = g.model;
  const add = (X, D, w = 1) => X.map((v, i) => v + w * D[i]);
  const bodyDef = add(res.body.rest, res.bodyDeltas[t]);
  const layers = [
    ['body rest', segs(res.body.rest, res.body.tri), '#999', 1],
    ['body ' + t, segs(bodyDef, res.body.tri), '#333', 1.5],
    ['garment rest', segs(m.X, m.weld.tri), '#9cf', 1],
    ['garment field only', segs(add(m.X, m.uField[t]), m.weld.tri), '#e66', 1],
    ['garment Tier 1', segs(add(m.X, g.deltas[t]), m.weld.tri), '#0a5', 1.5],
  ];
  const W = 900, H = 520, x0 = -0.6, x1 = 0.6, z0 = 0.0, z1 = 0.7 + Math.max(0, dot3(sub3(apex, f.origin), f.forward) / S - 0.55);
  const X = (x) => ((x - x0) / (x1 - x0)) * W, Z = (z) => H - ((z - z0) / (z1 - z0)) * H;
  let body = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const [, s, col, wd] of layers)
    for (const [a, b] of s) if (a[0] > x0 && a[0] < x1) body += `<line x1="${X(a[0]).toFixed(1)}" y1="${Z(a[1]).toFixed(1)}" x2="${X(b[0]).toFixed(1)}" y2="${Z(b[1]).toFixed(1)}" stroke="${col}" stroke-width="${wd}"/>`;
  layers.forEach(([name, , col], i) => (body += `<text x="10" y="${20 + i * 16}" font-size="13" fill="${col}" font-family="sans-serif">${name}</text>`));
  body += `<text x="10" y="${H - 10}" font-size="12" fill="#333" font-family="sans-serif">slice y=apex (body frame), x right = model left, z up = forward, S units</text>`;
  fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
  console.log(`  wrote ${out}`);
}
function at(P, i) {
  return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
