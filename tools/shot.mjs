// 브라우저 검증: 페이지 로드 → 생성 대기 → 조감/오버레이/탐험 스크린샷 + 콘솔 오류 수집.
// 사용: node tools/shot.mjs <url> <outdir> [--artifact]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const out = process.argv[3] || '.';
const artifact = process.argv.includes('--artifact');
const W = +(process.env.W || 1440), Hh = +(process.env.H || 900);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1, colorScheme: process.env.DARK ? 'dark' : 'light' });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
// CDN → 로컬 node_modules (컨테이너에서 외부 CDN 차단)
await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (route) => {
  const rel = route.request().url().replace(/^.*three@[^/]+\//, '');
  const file = path.join('node_modules/three', rel);
  route.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(file) });
});
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__app && window.__app.ctx && document.querySelector('#loading').hidden, null, { timeout: 120000 });
console.log('generated in', Date.now() - t0, 'ms');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, 'map.png') });
const steps = (process.env.STEPS || 'overlay,close,explore').split(',');
if (steps.includes('notes')) {
  await page.evaluate(() => document.querySelector('#open-notes').click());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'notes.png') });
  await page.evaluate(() => document.querySelector('#close-notes').click());
}
if (steps.includes('panel')) {
  await page.evaluate(() => document.querySelector('#toggle-right').click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'panel.png') });
  await page.evaluate(() => document.querySelector('#toggle-right').click());
}
if (steps.includes('overlay')) {
  await page.evaluate(() => window.__app.setOverlay('hidden'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'overlay-hidden.png') });
  await page.evaluate(() => window.__app.setOverlay('none'));
}
if (steps.includes('close')) {
  await page.evaluate(() => {
    const a = window.__app;
    const d = a.ctx.districts.find((x) => x.type === 'commercial');
    a.controls.target.set(d.x, 0, d.z);
    a.camera.position.set(d.x + 70, 85, d.z + 95);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'close.png') });
}
for (const st of steps.filter((x) => x.startsWith('view:'))) {
  // view:<districtType>[:dist]  — 해당 구역 중심(캠퍼스면 본관)으로 카메라
  const [, type, dist] = st.split(':');
  await page.evaluate(([type, dist]) => {
    const a = window.__app;
    const d = a.ctx.districts.find((x) => x.type === type);
    let x = d.x, z = d.z;
    if (d.campus && d.campus.main) { x = d.campus.main.x; z = d.campus.main.z; }
    const k = +(dist || 1);
    a.controls.target.set(x, 0, z);
    a.camera.position.set(x + 80 * k, 95 * k, z + 105 * k);
  }, [type, dist]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `view-${type}.png`) });
}
if (steps.includes('secret')) {
  await page.evaluate(() => {
    const a = window.__app;
    const s = a.ctx.secrets.find((q) => q.crumbs >= 4 && q.reveal === 'corner') || a.ctx.secrets[0];
    a.controls.target.set(s.x, 0, s.z);
    a.camera.position.set(s.x + 28, 40, s.z + 36);
    a.select({ entity: a.ctx.entities.find((e) => e.secret === s.id && e.kind === 'secretmark'), point: { x: s.x, z: s.z } });
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'secret.png') });
}
if (steps.includes('explore')) {
  await page.evaluate(() => window.__app.setMode('explore'));
  await page.waitForTimeout(500);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'explore.png') });
  const st = await page.evaluate(() => { const e = window.__app.explorer; return { x: e.pos.x, y: e.pos.y, z: e.pos.z }; });
  console.log('player', JSON.stringify(st));
}
console.log('errors:', errors.length ? errors.slice(0, 20).join('\n') : 'none');
await browser.close();
