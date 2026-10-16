// Headless screenshots of the viewer for visual verification.
//   node scripts/shoot.mjs [baseUrl] [outDir]
// Expects `npm run dev` (or preview) to be serving the app.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
fs.mkdirSync(out, { recursive: true });

const executablePath = process.env.CHROME_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + (base.includes('?') ? '&' : '?') + 'hud=0');
await page.waitForFunction(() => window.__bust?.ready === true, null, { timeout: 120000 });
await page.evaluate(() => { window.__bust.pause(); document.querySelector('.lil-gui')?.remove(); });

const shots = JSON.parse(process.env.SHOTS ?? 'null') ?? [
  { name: 'base_3q', view: 'threeQuarter', sliders: { size: 0, lift: 0, spread: 0 } },
  { name: 'size_up_natural_3q', view: 'threeQuarter', sliders: { size: 1, style: 0 } },
  { name: 'size_up_stylized_3q', view: 'threeQuarter', sliders: { size: 1, style: 1 } },
  { name: 'size_down_3q', view: 'threeQuarter', sliders: { size: -1 } },
  { name: 'base_side', view: 'closeSide', sliders: { size: 0, style: 0.5 } },
  { name: 'size_up_natural_side', view: 'closeSide', sliders: { size: 1, style: 0 } },
  { name: 'size_up_stylized_side', view: 'closeSide', sliders: { size: 1, style: 1 } },
  { name: 'lift_up_side', view: 'closeSide', sliders: { size: 0, lift: 1 } },
  { name: 'lift_down_side', view: 'closeSide', sliders: { size: 0, lift: -1 } },
  { name: 'spread_out_front', view: 'closeFront', sliders: { size: 0, lift: 0, spread: 1 } },
  { name: 'spread_in_front', view: 'closeFront', sliders: { size: 0, lift: 0, spread: -1 } },
  { name: 'heatmap_front', view: 'closeFront', sliders: { size: 0, spread: 0 }, heatmap: true, gizmo: true },
];

for (const s of shots) {
  await page.evaluate((s) => {
    const b = window.__bust;
    b.setSliders({ size: 0, style: 0.5, lift: 0, spread: 0, ...s.sliders });
    b.setHeatmap(!!s.heatmap);
    b.setGizmo(!!s.gizmo);
    if (s.params) b.setParams((p) => Object.assign(p, s.params));
    b.setView(s.view);
    b.step(1 / 60, 2);
  }, s);
  const file = path.join(out, `${s.name}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

if (process.env.VALIDATE !== '0') {
  const v = await page.evaluate(() => {
    const r = window.__bust.validate();
    return JSON.parse(JSON.stringify(r));
  });
  fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(v, null, 2));
  const bake = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bust.report().bake)));
  console.log('bake', JSON.stringify(bake));
  console.log('validation', JSON.stringify({ field: { minDet: v.field.minDet, minCombo: v.field.minCombo, volume: v.field.volume }, mesh: v.mesh, normals: v.normals }, null, 1));
}
await browser.close();
