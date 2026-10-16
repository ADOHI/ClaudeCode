import { chromium } from '@playwright/test';
const url = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.goto(url);
await p.waitForFunction(() => window.__bust?.ready, null, { timeout: 120000 });
const out = await p.evaluate(new Function(process.argv[3] ?? 'return null'));
console.log(JSON.stringify(out, null, 1));
await b.close();
