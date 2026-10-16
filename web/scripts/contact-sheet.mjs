// Review contact sheet + A/B page for bust slider states (decision-v2 P1-10).
//
//   node scripts/contact-sheet.mjs --model /models/<file> [--base http://localhost:5173/]
//        [--out DIR] [--states base,size_up_natural,size_up_stylized,...]
//        [--poses rest,armsUp] [--views front,q3L,sideL,sideR,q3R,top]
//        [--size 480] [--selection outer|skin|all]
//
// Needs the dev server (npm run dev). For every state x pose x view it renders
// the viewer from a fixed camera (front, 3/4 left, side left, side right,
// 3/4 right, top = 60 deg above the chest), measures the state with
// src/core/morpho.js on the bind data the page exports (same params, same bake
// as the viewer), and writes DIR/index.html: pick two states, see them side by
// side per view, their sagittal profiles with the landmarks overlaid, and a
// metrics table with deltas and band distances; below, the full grid.
//
// Renders of licensed test characters must never land in the repo: the
// default output dir is outside it and repo paths are refused.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurePrepared, deformPrepared, sectionProfile, scoreBands, METRICS, BANDS } from '../src/core/morpho.js';
import { loadBind, prepareBind } from '../../tools/morpho/bindio.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};

// Named states as viewer sliders (the viewer maps them with sliderToWeights).
export const STATE_SLIDERS = {
  base: {},
  size_up_natural: { size: 1, style: 0 },
  size_up_stylized: { size: 1, style: 1 },
  size_up_half: { size: 1, style: 0.5 },
  size_down: { size: -1 },
  lift_up: { lift: 1 },
  lift_down: { lift: -1 },
  spread_out: { spread: 1 },
  spread_in: { spread: -1 },
};
// armDown is measured from the T-pose (viewer state.anim.armDown): 65 = the
// viewer's relaxed default, -65 = arms raised 65 deg above horizontal (pose
// corrective active, as in game).
export const POSES = { rest: { armDown: 65 }, armsUp: { armDown: -65 } };
// Camera directions in the body frame (forward, left, up) and distance in S.
export const VIEWS = {
  front: { label: 'front', dir: [1, 0, 0], dist: 3.4 },
  q3L: { label: '3/4 L', dir: [0.8, 0.6, 0], dist: 3.4 },
  sideL: { label: 'side L', dir: [0, 1, 0], dist: 3.6 },
  sideR: { label: 'side R', dir: [0, -1, 0], dist: 3.6 },
  q3R: { label: '3/4 R', dir: [0.8, -0.6, 0], dist: 3.4 },
  top: { label: 'top (60 deg)', dir: [0.5, 0, 0.866], dist: 3.6, noLift: true },
};

function defaultOut() {
  if (process.env.BUST_SHOTS_DIR) return process.env.BUST_SHOTS_DIR;
  const scratch = '/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/shots';
  return path.join(fs.existsSync(path.dirname(scratch)) ? scratch : path.join(os.tmpdir(), 'bust-shots'), 'contact');
}

function guardOutside(dir) {
  const abs = path.resolve(dir);
  const rel = path.relative(REPO, abs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to write renders inside the repo (${abs}); pass --out outside ${REPO}`);
  return abs;
}

async function main() {
  const model = opt('model', null);
  const base = opt('base', 'http://localhost:5173/');
  const out = guardOutside(opt('out', defaultOut()));
  const stateNames = opt('states', 'base,size_up_natural,size_up_stylized,size_down,lift_up,lift_down').split(',');
  const poseNames = opt('poses', 'rest,armsUp').split(',');
  const viewNames = opt('views', Object.keys(VIEWS).join(',')).split(',');
  const size = +opt('size', 480);
  const selection = opt('selection', 'outer');
  for (const s of stateNames) if (!STATE_SLIDERS[s]) throw new Error(`unknown state ${s}`);
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });

  const executablePath = process.env.CHROME_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
  const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // Test-harness camera access until the viewer exposes __bust.setCamera:
  // append a debug handle to the served main.js module (module scope).
  await page.route('**/src/viewer/main.js*', async (route) => {
    const resp = await route.fetch();
    const body = (await resp.text()) + '\n;window.__bustDebug = { camera, controls, get model() { return model; } };\n';
    await route.fulfill({ response: resp, body });
  });
  const url = new URL(base);
  url.searchParams.set('hud', '0');
  if (model) url.searchParams.set('model', model);
  await page.goto(url.toString());
  await page.waitForFunction(() => window.__bust?.ready === true, null, { timeout: 240000 });
  await page.addStyleTag({ content: '.lil-gui, #status, #hud { display: none !important; }' });
  await page.evaluate(() => {
    const b = window.__bust;
    b.pause();
    b.setDyn({ enabled: false });
    b.setHeatmap(false);
    b.setGizmo(false);
  });

  // Bind data exactly as rendered (params include the viewer's auto-fit).
  const bindJson = await page.evaluate(() => JSON.stringify(window.__bust.exportBind()));
  const bind = loadBind(JSON.parse(bindJson));
  const modelName = model ?? '(default model)';
  const prep = prepareBind(bind, { selection, params: bind.params });

  const shots = [];
  const metrics = {};
  const profiles = {};
  for (const sn of stateNames) {
    for (const pn of poseNames) {
      await page.evaluate(({ sliders, pose }) => {
        const b = window.__bust;
        b.setSliders({ size: 0, style: 0.5, lift: 0, spread: 0, ...sliders });
        b.setAnim({ play: false, ...pose });
        b.step(1 / 60, 3);
      }, { sliders: STATE_SLIDERS[sn], pose: POSES[pn] });
      // weights actually on the mesh (sliders + pose corrective)
      const weights = await page.evaluate(() => ({ ...(window.__bustDebug.model.weights ?? {}) }));
      const res = measurePrepared(prep.ctx, weights);
      metrics[`${sn}|${pn}`] = { weights, mean: res.mean, sides: res.sides.map(slim) };
      if (pn === poseNames[0]) profiles[sn] = sagittalProfile(prep.ctx, weights, res);
      for (const vn of viewNames) {
        await page.evaluate((v) => {
          const b = window.__bust, d = window.__bustDebug;
          if (b.setCamera) return b.setCamera(v);
          b.setView('closeFront'); // aims controls.target at the apex midpoint (posed chest)
          const f = d.model.restFrame, S = f.S, V = d.camera.position.constructor;
          const fw = new V(...f.forward), lf = new V(...f.left), up = new V(...f.up);
          const dir = fw.multiplyScalar(v.dir[0]).add(lf.multiplyScalar(v.dir[1])).add(up.clone().multiplyScalar(v.dir[2])).normalize();
          const t = d.controls.target.clone();
          d.camera.position.copy(t).addScaledVector(dir, v.dist * S);
          if (!v.noLift) d.camera.position.addScaledVector(up, 0.15 * S);
          d.controls.update();
          b.step(1 / 60, 1);
        }, VIEWS[vn]);
        const file = `img/${sn}__${pn}__${vn}.png`;
        await page.screenshot({ path: path.join(out, file) });
        shots.push({ state: sn, pose: pn, view: vn, file });
      }
      console.log(`rendered ${sn} / ${pn}`);
    }
  }
  await browser.close();

  const ref = metrics[`base|${poseNames[0]}`]?.mean ?? null;
  for (const m of Object.values(metrics)) {
    m.bands = Object.fromEntries(Object.entries(BANDS).map(([k, b]) => [k, scoreBands(m.mean, b, { reference: ref }).distance]));
  }
  const data = {
    model: modelName,
    created: new Date().toISOString(),
    selection,
    params: bind.params,
    states: stateNames,
    stateSliders: Object.fromEntries(stateNames.map((s) => [s, STATE_SLIDERS[s]])),
    poses: poseNames,
    views: viewNames.map((v) => ({ key: v, label: VIEWS[v].label })),
    metricsList: METRICS,
    bands: Object.fromEntries(Object.entries(BANDS).map(([k, b]) => [k, { label: b.label, metrics: b.metrics }])),
    shots,
    metrics,
    profiles,
  };
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(out, 'index.html'), renderPage(data));
  console.log(`wrote ${path.join(out, 'index.html')} (${shots.length} images)`);
}

function slim(r) {
  const keep = ['side', 'ok', 'flags', 'apex', 'nipple', 'top', 'bottom', 'imf', 'medial', 'lateral', ...METRICS.map((m) => m.key)];
  return Object.fromEntries(keep.filter((k) => k in r).map((k) => [k, r[k]]));
}

// Sagittal envelope of the left side for the profile overlay (S units).
function sagittalProfile(ctx, weights, res) {
  const m = res.sides[0];
  if (!m.apex) return null;
  const P = deformPrepared(ctx, weights);
  const y0 = m.apex[1] - 0.45, n = 361, step = 0.0025;
  const pr = sectionProfile(P, ctx.tris, 1, 'u', m.apex[0], y0, n, step);
  const pts = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(pr.z[i])) pts.push([+(y0 + i * step).toFixed(4), +pr.z[i].toFixed(4)]);
  const lm = {};
  for (const k of ['apex', 'nipple']) if (m[k]) lm[k] = [m[k][1], m[k][2]];
  for (const k of ['top', 'bottom', 'imf']) if (m[k]) lm[k] = m[k];
  return { pts, landmarks: lm, ok: m.ok };
}

function renderPage(data) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bust contact sheet</title>
<style>
:root { color-scheme: dark; --bg:#17191e; --panel:#20232a; --line:#333842; --text:#d8dae0; --dim:#8b909a; --a:#5aa9ff; --b:#ff9f5a; --ok:#7ddc8a; --bad:#ff7a7a; }
body { margin:0; background:var(--bg); color:var(--text); font:13px/1.45 system-ui, sans-serif; }
header, section { padding:12px 16px; }
h1 { font-size:18px; margin:0 0 4px; } h2 { font-size:15px; margin:18px 0 8px; }
.dim { color:var(--dim); } .controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
select { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:4px; padding:3px 6px; }
.ab { display:grid; grid-template-columns: 56px 1fr 1fr; gap:6px; align-items:center; }
.ab img, .grid img { width:100%; height:auto; display:block; border-radius:4px; background:#000; }
.ab .lab { color:var(--dim); text-align:right; padding-right:6px; }
.colA { border-top:3px solid var(--a); } .colB { border-top:3px solid var(--b); }
table { border-collapse:collapse; font-variant-numeric: tabular-nums; }
td, th { border-bottom:1px solid var(--line); padding:3px 10px; text-align:right; } th { color:var(--dim); font-weight:500; }
td:first-child, th:first-child { text-align:left; }
.flags { color:var(--dim); font-size:12px; max-width:1100px; }
.grid { display:grid; gap:4px; overflow-x:auto; }
.grid .h { color:var(--dim); font-size:12px; text-align:center; }
.wrap { display:grid; grid-template-columns: minmax(360px, 720px) minmax(340px, 1fr); gap:24px; align-items:start; }
.side { position:sticky; top:8px; }
@media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } .side { position:static; } }
svg text { fill:var(--dim); font-size:10px; }
</style></head><body>
<header>
<h1>Bust contact sheet: ${esc(data.model)}</h1>
<div class="dim">${esc(data.created)} &middot; morphometrics on <b>${esc(data.selection)}</b> triangles, sliders as in the viewer, arms-up pose includes the pose corrective &middot; anchor ${esc(JSON.stringify(data.params.anchor))} &middot; private test output, do not commit or share</div>
</header>
<section>
<div class="controls">
<label>A <select id="selA"></select></label>
<label>B <select id="selB"></select></label>
<label>pose <select id="selP"></select></label>
</div>
<div class="wrap">
<div><h2>views</h2><div id="ab" class="ab"></div></div>
<div class="side"><h2>metrics (mean of both sides)</h2><table id="mt"></table><div id="flags" class="flags"></div>
<h2>sagittal profile through the apex (left side, rest pose)</h2><div id="prof"></div></div>
</div>
</section>
<section><h2>all states</h2><div id="grid" class="grid"></div></section>
<script>
const D = ${JSON.stringify(data)};
const $ = (id) => document.getElementById(id);
const img = (s, p, v) => (D.shots.find((x) => x.state === s && x.pose === p && x.view === v) || {}).file;
for (const [id, list, def] of [['selA', D.states, D.states[0]], ['selB', D.states, D.states[Math.min(1, D.states.length - 1)]], ['selP', D.poses, D.poses[0]]]) {
  for (const s of list) $(id).add(new Option(s, s, false, s === def));
  $(id).onchange = render;
}
const fmt = (v, k) => v == null ? '-' : k === 'upperPoleFrac' ? (v * 100).toFixed(1) : k.endsWith('Deg') ? v.toFixed(1) : v.toFixed(3);
function render() {
  const A = $('selA').value, B = $('selB').value, P = $('selP').value;
  $('ab').innerHTML = '<div></div><div class="h colA">' + A + '</div><div class="h colB">' + B + '</div>' +
    D.views.map((v) => '<div class="lab">' + v.label + '</div><img loading="lazy" src="' + img(A, P, v.key) + '"><img loading="lazy" src="' + img(B, P, v.key) + '">').join('');
  const ma = D.metrics[A + '|' + P], mb = D.metrics[B + '|' + P];
  let h = '<tr><th>metric</th><th style="color:var(--a)">A</th><th style="color:var(--b)">B</th><th>B - A</th></tr>';
  for (const m of D.metricsList) {
    const a = ma.mean[m.key], b = mb.mean[m.key];
    const d = a == null || b == null ? null : b - a;
    h += '<tr><td>' + m.label + (m.unit ? ' (' + m.unit + ')' : '') + '</td><td>' + fmt(a, m.key) + '</td><td>' + fmt(b, m.key) + '</td><td>' + fmt(d, m.key) + '</td></tr>';
  }
  h += '<tr><td>upper pole shape</td><td>' + (ma.mean.upperShape || '-') + '</td><td>' + (mb.mean.upperShape || '-') + '</td><td></td></tr>';
  for (const k of Object.keys(D.bands)) h += '<tr><td>distance to ' + D.bands[k].label + '</td><td>' + fmt(ma.bands[k], 'x') + '</td><td>' + fmt(mb.bands[k], 'x') + '</td><td></td></tr>';
  h += '<tr><td>weights</td><td colspan="3" style="text-align:left" class="dim">A ' + wstr(ma.weights) + '<br>B ' + wstr(mb.weights) + '</td></tr>';
  $('mt').innerHTML = h;
  $('flags').textContent = 'flags A: ' + (ma.mean.flags.join(', ') || '-') + ' | B: ' + (mb.mean.flags.join(', ') || '-');
  $('prof').innerHTML = profileSvg([[D.profiles[A], 'var(--a)'], [D.profiles[B], 'var(--b)']]);
}
const wstr = (w) => Object.entries(w).filter(([, v]) => v > 1e-3).map(([k, v]) => k.replace('bust_', '') + '=' + v.toFixed(2)).join(' ') || '(none)';
function profileSvg(list) {
  const all = list.filter(([p]) => p).flatMap(([p]) => p.pts);
  if (!all.length) return '<div class="dim">no profile</div>';
  const ys = all.map((p) => p[0]), zs = all.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys), z1 = Math.max(...zs), z0 = Math.max(Math.min(...zs), z1 - (y1 - y0) * 0.8);
  const W = 300, H = Math.round((W * (y1 - y0)) / (z1 - z0));
  const X = (z) => ((z - z0) / (z1 - z0)) * (W - 20) + 10, Y = (y) => H - 10 - ((y - y0) / (y1 - y0)) * (H - 20);
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  for (const [p, col] of list) {
    if (!p) continue;
    s += '<polyline fill="none" stroke="' + col + '" stroke-width="1.5" points="' + p.pts.filter((q) => q[1] >= z0).map((q) => X(q[1]).toFixed(1) + ',' + Y(q[0]).toFixed(1)).join(' ') + '"/>';
    for (const [k, q] of Object.entries(p.landmarks)) {
      s += '<circle cx="' + X(q[1]).toFixed(1) + '" cy="' + Y(q[0]).toFixed(1) + '" r="3" fill="' + col + '"/><text x="' + (X(q[1]) + 5).toFixed(1) + '" y="' + (Y(q[0]) + 3).toFixed(1) + '">' + ({ apex: 'A', nipple: 'N', top: 'T', bottom: 'L', imf: 'IMF' })[k] + '</text>';
    }
  }
  return s + '<text x="10" y="12">forward &rarr;  (up)</text></svg>';
}
function grid() {
  const cols = D.states.length;
  let h = '<div class="h"></div>' + D.states.map((s) => '<div class="h">' + s + '</div>').join('');
  for (const p of D.poses) for (const v of D.views) h += '<div class="h">' + p + '<br>' + v.label + '</div>' + D.states.map((s) => '<img loading="lazy" src="' + img(s, p, v.key) + '">').join('');
  $('grid').style.gridTemplateColumns = '80px repeat(' + cols + ', minmax(140px, 1fr))';
  $('grid').innerHTML = h;
}
render();
grid();
</script></body></html>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

