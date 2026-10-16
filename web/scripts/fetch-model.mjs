// Downloads the public test models into public/models/ (git-ignored; never
// commit third-party models).
//   Seed-san  - VRM Public License 1.0, VirtualCast, Inc. (flat-chested: used for
//               clothing-layer / strap / seam tests, not for bust shape quality)
//   Michelle  - Mixamo character from the three.js examples (realistic, low poly)
import fs from 'node:fs';
import path from 'node:path';

const MODELS = {
  'Seed-san.vrm': 'https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm',
  'Michelle.glb': 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Michelle.glb',
};
const dir = path.resolve('public/models');
fs.mkdirSync(dir, { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const out = path.join(dir, name);
  if (fs.existsSync(out)) { console.log('exists', name); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', name);
}
