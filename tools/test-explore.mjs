// 탐험 메커닉 자동 검증: 사다리 오르기, 지붕 착지, 열쇠 획득 → 철문 열기, 비밀 수집, 매달려 오르기.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const out = process.argv[3] || '.';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(path.join('node_modules/three', r.request().url().replace(/^.*three@[^/]+\//, ''))) }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await page.goto(url);
await page.waitForFunction(() => window.__app && window.__app.ctx && document.querySelector('#loading').hidden, null, { timeout: 120000 });

await page.evaluate(() => {
  window.__sim = (sec) => { const a = window.__app; for (let t = 0; t < sec; t += 1 / 60) a.explorer.update(1 / 60, a.camera); };
});
const results = {};
const step = async (ms) => page.waitForTimeout(ms);
// 1) 사다리
results.ladder = await page.evaluate(async () => {
  const a = window.__app;
  const lad = a.ctx.entities.find((e) => e.climb && e.rule === 'intent.rooftop') || a.ctx.entities.find((e) => e.climb);
  a.setMode('explore', { x: lad.climb.x, z: lad.climb.z });
  const ex = a.explorer;
  ex.pos.set(lad.climb.x - lad.climb.nx * 0.9, 0, lad.climb.z - lad.climb.nz * 0.9);
  ex.pos.y = Math.max(0, ex.pos.y);
  window.__sim(0.3);
  ex.keys.KeyE = true;
  window.__sim(4);
  ex.keys.KeyE = false;
  const onRoof = { y: ex.pos.y };
  // 지붕 위에서 다시 E → 내려가기
  ex.keys.KeyE = true;
  window.__sim(4);
  ex.keys.KeyE = false;
  return { top: lad.climb.top, yAfterClimb: onRoof.y, yAfterDescend: ex.pos.y, anim: !!ex.anim };
});
await page.screenshot({ path: path.join(out, 'test-ladder.png') });
// 2) 열쇠 → 문
results.gate = await page.evaluate(async () => {
  const a = window.__app;
  const ex = a.explorer;
  const g = (a.ctx.gates2 || [])[0];
  if (!g) return 'no gate';
  ex.anim = null;
  ex.pos.set(g.key.x, 0, g.key.z);
  window.__sim(0.3);
  const hasKey = ex.inventory.keys.has(g.id);
  ex.pos.set(g.x + Math.cos(g.rot) * -1.5, 0, g.z + Math.sin(g.rot) * -1.5);
  window.__sim(0.3);
  const before = ex.probe(g.x, g.z, 0).ok;
  ex.keys.KeyE = true;
  window.__sim(0.2);
  const after = ex.probe(g.x, g.z, 0).ok;
  return { hasKey, blockedBefore: !before, passableAfter: after, open: ex.gates[0].open };
});
// 3) 비밀 수집
results.secret = await page.evaluate(async () => {
  const a = window.__app;
  const ex = a.explorer;
  const s = a.ctx.secrets.find((q) => q.y < 1);
  ex.anim = null;
  ex.pos.set(s.x + 0.5, 0, s.z + 0.5);
  window.__sim(0.3);
  return { got: ex.inventory.secrets.size, name: s.name };
});
// 4) 매달려 오르기: 낮은 건물 벽으로 점프하며 전진
results.mantle = await page.evaluate(async () => {
  const a = window.__app;
  const ex = a.explorer;
  const b = a.ctx.buildings.find((q) => !q.deleted && q.h > 2.5 && q.h < 3.4 && q.front >= 0 && !q.campus && !a.ctx.entities.some((e) => e.ref === q.id && e.cat === 'roof' && !e.deleted));
  if (!b) return 'no low building';
  const fx = b.x + Math.cos(b.rot) * 0, fz = b.z;
  // 정면 바깥 3m 지점에서 건물 쪽으로
  const k = b.front;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const L = [[-b.w / 2 - 2.5, 0], [b.w / 2 + 2.5, 0], [0, -b.d / 2 - 2.5], [0, b.d / 2 + 2.5]][k];
  const px = b.x + L[0] * c - L[1] * s, pz = b.z + L[0] * s + L[1] * c;
  ex.anim = null;
  ex.pos.set(px, 0, pz);
  const dirx = b.x - px, dirz = b.z - pz;
  ex.yaw = Math.atan2(-dirx, -dirz);
  window.__sim(0.2);
  const y0 = ex.pos.y;
  ex.keys.KeyW = true; ex.keys.Space = true;
  const trace = [];
  for (let t = 0; t < 1.5; t += 0.1) { window.__sim(0.1); trace.push(`${ex.pos.y.toFixed(2)}${ex.grounded ? 'g' : ''}${ex.anim ? 'a' : ''}`); }
  window.__trace = trace.join(' ');
  ex.keys.KeyW = false; ex.keys.Space = false;
  window.__sim(0.5);
  return { roof: b.h, prog: b.prog, y0, y: ex.pos.y, trace: window.__trace };
  void fx; void fz;
  return { roof: b.h, y: ex.pos.y };
});
await page.screenshot({ path: path.join(out, 'test-mantle.png') });
console.log(JSON.stringify(results, null, 1));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
