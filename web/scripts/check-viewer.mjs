// End-to-end checks against real loaded meshes and their GPU morph attributes.
// npm run fetch-model && npx playwright install chromium && npm run test:viewer
// Optional: --model /models/Changli/Changli.pmx --out <screenshot-dir>
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseArg = opt('--base', null);
const base = baseArg ?? 'http://127.0.0.1:5178/';
const models = args.includes('--model') ? [opt('--model')] : ['/models/Michelle.glb', '/models/Seed-san.vrm'];
const out = path.resolve(opt('--out', '.cache/viewer-check'));
fs.mkdirSync(out, { recursive: true });
let server, browser;
try {
  if (!baseArg) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let startup = '';
    server.stdout.on('data', d => startup += d); server.stderr.on('data', d => startup += d);
    server.on('error', e => startup += e.message);
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error(`Vite exited: ${startup}`);
      try { if ((await fetch(base)).ok) break; } catch {}
      if (i > 100) throw new Error(`Vite did not start: ${startup}`);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const model of models) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}?model=${encodeURIComponent(model)}`);
    await page.waitForFunction(() => window.__bust?.ready, null, { timeout: 180000 });
    const result = await page.evaluate(async () => {
      const lab = window.__bust;
      lab.pause(); lab.setTissue({ enabled: false }); lab.setDyn({ enabled: false }); lab.setAnim({ play: false });
      const baseline = JSON.parse(JSON.stringify(lab.state.params));
      lab.setSliders({ size: 0.8, style: 0.4, lift: 0.2 }); lab.step(1 / 60);
      const initial = lab.exportBind();
      const p = JSON.parse(JSON.stringify(baseline)); p.anchor.x += 0.01; p.mask.excludeArms = false;
      p.targets.bust_size_up_natural[0].k *= 0.8;
      lab.importParams({ format: 'bust-morph-params/1', params: p }, 'Imported smoke params');
      const fittedAnchor = lab.state.params.anchor.x;
      lab.step(1 / 60);
      const importedWeights = lab.weights();
      lab.selectPreset('Hand tuned');
      const restored = JSON.stringify(lab.state.params) === JSON.stringify(baseline);
      lab.selectPreset('Imported smoke params');
      const selectedAgain = lab.state.params.anchor.x === fittedAnchor;
      let rejected = false;
      try { lab.importParams({ ...p, depth: 0 }, 'invalid'); } catch { rejected = true; }
      const rejectedSafely = rejected && lab.state.preset === 'Imported smoke params';
      const profile = { format: 'bust-character-profile/1', name: 'Smoke character', bones: Object.fromEntries(['chest', 'hips', 'leftUpperArm', 'rightUpperArm'].map(k => [k, initial.bones[k]])), materials: [], region: { anchor: { x: fittedAnchor } } };
      await lab.importProfile(profile);
      lab.setAnim({ armDown: 65 }); lab.step(1 / 60);
      const armsDown = lab.runtime().armDeg;
      lab.setAnim({ armDown: -30 }); lab.step(1 / 60);
      const armsRaised = lab.runtime().armDeg;
      lab.setAnim({ armDown: 65 });
      lab.setDyn({ enabled: true }); lab.setAnim({ play: true, bob: 0.03 });
      lab.step(1 / 60, 80);
      const activeWeights = lab.weights();
      lab.step(0.25); // hitch must reach the tracker at its actual duration
      const hitchWeights = lab.weights();
      const metrics = lab.metrics();
      const bind = lab.exportBind();
      lab.baselineDemo();
      lab.step(1 / 60, 300);
      const beforeRateEdit = lab.runtime().bodyBob;
      lab.setAnim({ bobHz: 4 }); lab.step(1e-6);
      const afterRateEdit = lab.runtime().bodyBob;
      const beforeStop = afterRateEdit;
      lab.setAnim({ play: false }); lab.step(1e-6);
      const afterStop = lab.runtime().bodyBob;
      lab.step(1 / 60, 360);
      const settledBody = lab.runtime().bodyBob;
      const settledDynamic = Math.max(0, ...Object.entries(lab.weights()).filter(([k]) => k.startsWith('bust_dyn_')).map(([, w]) => Math.abs(w)));
      lab.baselineDemo(); lab.step(1 / 60, 90);
      return { restored, selectedAgain, rejectedSafely, fittedAnchor, finalAnchor: lab.state.params.anchor.x, armsDown, armsRaised,
        rateEditJump: Math.abs(afterRateEdit - beforeRateEdit), stopJump: Math.abs(afterStop - beforeStop), settledBody, settledDynamic,
        importedWeights, activeWeights, hitchWeights, runtime: lab.runtime(), metricsOk: !!metrics?.sides?.length,
        touched: lab.report().bake.touched, meshes: bind.meshes.length,
        targets: Object.keys(bind.params.targets), hud: document.getElementById('hud').textContent };
    });
    assert.equal(result.restored, true, 'A/B restores edited baseline');
    assert.equal(result.selectedAgain, true, 'A/B preserves imported fit');
    assert.equal(result.rejectedSafely, true, 'invalid import leaves active preset unchanged');
    assert.equal(result.finalAnchor, result.fittedAnchor, 'profile anchor retained');
    assert.ok(Math.abs(result.armsDown - 25) < 3 && Math.abs(result.armsRaised - 120) < 3, 'profile arm overrides retain posing (including VRM normalized bones)');
    assert.ok(result.touched > 0 && result.meshes > 0);
    assert.ok(result.metricsOk && result.hud.includes('morphometrics'));
    assert.ok(result.targets.some(t => t.startsWith('bust_dyn_')) && result.targets.some(t => t.startsWith('bust_vs_')));
    assert.ok(Object.entries(result.activeWeights).some(([k, w]) => k.startsWith('bust_dyn_') && Math.abs(w) > 1e-5), 'dedicated dynamic shapes driven');
    assert.ok(Object.values(result.hitchWeights).every(Number.isFinite), 'hitch produces finite weights');
    assert.equal(result.importedWeights.bust_size_up_natural, 0.48);
    assert.ok(result.rateEditJump < 1e-5 && result.stopJump < 1e-5, 'source rate edits/stopping preserve body position');
    assert.ok(Math.abs(result.settledBody) < 1e-10 && result.settledDynamic < 1e-4, 'stationary body allows bust response to settle');
    assert.deepEqual(errors, [], 'no browser exceptions');
    const label = path.basename(model).replace(/\.[^.]+$/, '');
    await page.screenshot({ path: path.join(out, `${label}.png`) });
    fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(result, null, 2));
    console.log(`${model}: A/B, profile, ${result.targets.length} targets, metrics, dynamics/hitch, continuous motion edits + settling passed (${result.touched} vertices)`);
    await page.close();
  }
} finally {
  await browser?.close();
  server?.kill();
}
