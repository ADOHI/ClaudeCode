// Run the JS morphometrics (web/src/core/morpho.js) for the Python parity
// tests and tools.
//   node tools/morpho/measure_js.mjs <request.json | ->
// request (raw mesh):
//   {frame, meshes: [{pos, tris?, index?, mask?, deltas?}], apex, opts?, shoulderY?,
//    states: [weights | null, ...]}
// request (bust-bind export; bakes DEFAULT_PARAMS with the viewer's auto-fit):
//   {bind: "path.bind.json", selection?: "outer", opts?, states: [name | weights, ...],
//    dumpCtx?: true}   -> also returns the prepared context {B, tris, D, est,
//                         shoulderY, hipsY, neckY, o} so Python can measure the
//                         exact same data.
// Prints {results: [{sides, mean, ok}, ...], ctx?} as JSON.
import fs from 'node:fs';
import { prepareMorpho, measurePrepared } from '../../web/src/core/morpho.js';
import { loadBind, prepareBind, stateWeights } from './bindio.mjs';

const src = process.argv[2] ?? '-';
const req = JSON.parse(fs.readFileSync(src === '-' ? 0 : src, 'utf8'));
let ctx;
if (req.bind) {
  ctx = prepareBind(loadBind(req.bind), { selection: req.selection ?? 'outer', opts: req.opts ?? {} }).ctx;
} else {
  ctx = prepareMorpho({ frame: req.frame, meshes: req.meshes, apex: req.apex, opts: req.opts ?? {}, shoulderY: req.shoulderY ?? null });
}
const states = req.states ?? [null];
const results = states.map((s) => measurePrepared(ctx, s === null ? null : stateWeights(s)));
const out = { results };
if (req.dumpCtx) {
  out.ctx = {
    B: Array.from(ctx.B),
    tris: Array.from(ctx.tris),
    D: Object.fromEntries(Object.entries(ctx.D).map(([k, v]) => [k, Array.from(v)])),
    est: ctx.est,
    shoulderY: ctx.shoulderY,
    hipsY: ctx.hipsY,
    neckY: ctx.neckY,
    o: ctx.o,
    weights: states.map((s) => (s === null ? null : stateWeights(s))),
  };
}
process.stdout.write(JSON.stringify(out));
