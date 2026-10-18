// Deterministic, synthetic fixtures only. Run from any cwd:
//   node web/scripts/gen-golden.mjs [--check]
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildBodyFrame, createBustField, DEFAULT_PARAMS, falloff, fromBody, sliderToWeights, toBody } from '../src/core/field.js';
import { m3Inverse, m3Transpose, m3Vec, normalize } from '../src/core/vec.js';

const ROOT = new URL('../../', import.meta.url);
const OUTPUT = new URL('docs/golden.json', ROOT);
const SOURCES = ['web/scripts/gen-golden.mjs', 'web/src/core/field.js', 'web/src/core/kelvinlet.js', 'web/src/core/vec.js'];

function normalTransform(J, n) {
  const F = J.map((v, i) => v + (i % 4 === 0 ? 1 : 0));
  const inverse = m3Inverse(F);
  if (!inverse) throw new Error('singular synthetic golden sample');
  return normalize(m3Vec(m3Transpose(inverse), n));
}

export async function generateGolden() {
  // Include the source file names and normalize line endings so Windows and
  // Unix checkouts produce the same hash. No timestamp or model file is read.
  const hash = createHash('sha256');
  for (const name of SOURCES) hash.update(name + '\n').update((await readFile(new URL(name, ROOT), 'utf8')).replace(/\r\n?/g, '\n')).update('\n');
  const seedFrame = {
    origin: [0.7, -0.2, 1.3], left: [0.8, 0, -0.6],
    up: [0.36, 0.8, 0.48], forward: [0.48, -0.6, 0.64], S: 1.6,
  };
  const joint = (b) => fromBody(seedFrame, b.map((v) => v * seedFrame.S));
  const joints = {
    hips: joint([0, -1.2, 0]), chest: joint([0, 0, 0]), neck: joint([0, 0.5, 0]),
    leftUpperArm: joint([0.5, 0.3, 0]), rightUpperArm: joint([-0.5, 0.3, 0]),
  };
  const frame = buildBodyFrame(joints);
  const field = createBustField(frame, DEFAULT_PARAMS);
  const points = [];
  for (const side of field.sides) {
    for (const x of [-1.05, -0.5, 0, 0.5, 1.05]) for (const y of [-1.05, -0.5, 0, 0.5, 1.05]) {
      for (const z of [-1.05 * DEFAULT_PARAMS.window.zBack, 0, 0.4 * DEFAULT_PARAMS.window.zFront, 1.05 * DEFAULT_PARAMS.window.zFront]) {
        const q = [x * DEFAULT_PARAMS.window.x, y * (y < 0 ? DEFAULT_PARAMS.window.yDown : DEFAULT_PARAMS.window.yUp), z].map((v) => v * frame.S);
        const d = field.fromSideVec(side, q);
        points.push(side.base.map((v, i) => v + d[i]));
      }
    }
    points.push(side.base, side.apex);
  }
  // Explicit midline-band probes supplement the two support grids.
  for (const x of [-0.15, -0.1, -0.05, -0.001, 0, 0.001, 0.05, 0.1, 0.15]) points.push(fromBody(frame, [x, 0.05, 0.4].map((v) => v * frame.S)));
  const normals = [[0, 0, 1], normalize([1, 1, 1]), normalize([-2, 1, 3])];
  const sliderInputs = [{}, { size: 1, style: 0 }, { size: 1, style: 1 }, { size: 0.8, style: 0.25, lift: -0.5, spread: 0.75 }, { size: -1, lift: 1, spread: -1 }, { size: 4, style: -1, lift: -3, spread: 2 }];
  return {
    format: 'bust-golden/1', version: 1, generatorHash: `sha256:${hash.digest('hex')}`,
    generatorSources: SOURCES, units: 'bind-space; normalized parameter lengths use shoulder width S',
    params: DEFAULT_PARAMS, joints, frame, normalInputs: normals,
    sliderCases: sliderInputs.map((input) => ({ input, weights: sliderToWeights(input) })),
    falloffCases: [0, 0.15, 0.3].flatMap((hardness) => [-0.1, 0, hardness, 0.5, 0.75, 1, 1.1].map((t) => ({ t, hardness, value: falloff(t, hardness) }))),
    samples: points.map((p) => {
      const body = toBody(frame, p), x = body[0] / frame.S;
      const mid = DEFAULT_PARAMS.midline, lock = DEFAULT_PARAMS.midlineLock;
      return {
        point: p, bodyPoint: body, weight: field.weight(p),
        sides: field.sides.map((side) => {
          const q = field.toSide(side, p), signedX = side.s * x;
          return { side: side.s, q, window: field.windowWeight(q), share: signedX >= mid ? 1 : signedX <= -mid ? 0 : falloff((mid - signedX) / (2 * mid), 0) };
        }),
        lateralLockFactor: Math.abs(x) >= lock ? 1 : (Math.abs(x) / lock) * (2 - Math.abs(x) / lock),
        targets: Object.fromEntries(field.targets.map((target) => {
          const jacobian = field.jacobian(target, p);
          return [target, { delta: field.delta(target, p), jacobian, normals: normals.map((n) => normalTransform(jacobian, n)) }];
        })),
      };
    }),
  };
}

// Keep a sample on one line: the file stays readable without tens of thousands
// of lines of array elements, while remaining ordinary portable JSON.
export function serializeGolden(data) {
  const { samples, ...header } = data;
  return JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "samples": [\n' + samples.map((sample) => '    ' + JSON.stringify(sample)).join(',\n') + '\n  ]\n}\n';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const content = serializeGolden(await generateGolden());
  if (process.argv.includes('--check')) {
    if ((await readFile(OUTPUT, 'utf8')).replace(/\r\n/g, '\n') !== content) throw new Error('golden fixture changed; review the field change and run npm run golden');
    process.stdout.write('Synthetic golden fixture matches.\n');
  } else {
    await writeFile(OUTPUT, content, 'utf8');
    process.stdout.write(`Wrote ${fileURLToPath(OUTPUT)}\n`);
  }
}
