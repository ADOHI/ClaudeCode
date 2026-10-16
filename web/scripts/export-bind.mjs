// Export bind-space mesh data (bust-bind/1) for the Python bake tools.
//   node scripts/export-bind.mjs <modelUrlPath> <out.json> [baseUrl]
// e.g. node scripts/export-bind.mjs /models/Changli/Changli.pmx .cache/changli.bind.json
// Requires the dev server (npm run dev).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [model, out, base = 'http://localhost:5173/'] = process.argv.slice(2);
if (!model || !out) {
  console.error('usage: node scripts/export-bind.mjs <modelUrlPath> <out.json> [baseUrl]');
  process.exit(1);
}
const executablePath = process.env.CHROME_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}?hud=0&model=${encodeURIComponent(model)}`);
await page.waitForFunction(() => window.__bust?.ready === true, null, { timeout: 180000 });
const data = await page.evaluate(() => JSON.stringify(window.__bust.exportBind()));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, data);
console.log(`wrote ${out} (${(data.length / 1e6).toFixed(1)} MB)`);
await browser.close();
