// Evaluate the JS bust field (src/core/field.js) for given params + frame at
// given points and print JSON. Used by the Python port (tools/bustfield) for
// parity / round-trip tests: distilled params must mean the same thing here.
//
//   node scripts/eval-field.mjs request.json      (or the request on stdin)
//
// Request (all keys optional except a frame source when points are given):
//   frame     body frame {origin, left, up, forward, S}  | joints {hips, chest, neck, leftUpperArm, rightUpperArm}
//   params    field params (default: DEFAULT_PARAMS)
//   points    [[x, y, z], ...] bind-space points
//   targets   target names (default: all targets of params)
//   jacobian  true => also d(delta)/dp (row-major 9 per point)
//   weight    true => field.weight per point
//   sliders   [{size, style, lift, spread}, ...] => sliderToWeights
//   check     {res} => validate.js fieldCheck (injectivity gate)
//   body      [[x, y, z], ...] => toBody / fromBody round trip of these points
// Numbers are printed with JSON.stringify (shortest round-trip repr, exact).
import fs from 'node:fs';
import { buildBodyFrame, createBustField, DEFAULT_PARAMS, sliderToWeights, toBody, fromBody } from '../src/core/field.js';
import { fieldCheck } from '../src/core/validate.js';

const src = process.argv[2] && process.argv[2] !== '-' ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8');
const req = JSON.parse(src);

const out = { defaultParams: DEFAULT_PARAMS };
const frame = req.frame ?? (req.joints ? buildBodyFrame(req.joints) : null);
if (frame) out.frame = frame;
const params = req.params ?? DEFAULT_PARAMS;

if (frame && (req.points || req.check)) {
  const field = createBustField(frame, params);
  const targets = req.targets ?? field.targets;
  out.S = field.S;
  out.targets = targets;
  out.sides = field.sides.map((s) => ({ s: s.s, base: s.base, apex: s.apex }));
  if (req.points) {
    out.delta = {};
    if (req.jacobian) out.jacobian = {};
    for (const t of targets) {
      out.delta[t] = req.points.map((p) => field.delta(t, p));
      if (req.jacobian) out.jacobian[t] = req.points.map((p) => field.jacobian(t, p));
    }
    if (req.weight) out.weight = req.points.map((p) => field.weight(p));
  }
  if (req.check) out.check = fieldCheck(field, req.check);
}
if (req.sliders) out.sliders = req.sliders.map((s) => sliderToWeights(s));
if (frame && req.body) {
  out.toBody = req.body.map((p) => toBody(frame, p));
  out.fromBody = req.body.map((p) => fromBody(frame, p));
}
process.stdout.write(JSON.stringify(out));
