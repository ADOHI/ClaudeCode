// Requires npm run dev. No model data is committed; pass a locally owned model.
// node scripts/check-tissue.mjs /models/Michelle.glb <output-directory> [base-url]
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [model = '/models/Michelle.glb', output = '.cache/tissue-check', base = 'http://127.0.0.1:5173/'] = process.argv.slice(2);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}?model=${encodeURIComponent(model)}`);
  await page.waitForFunction(() => window.__bust?.ready, null, { timeout: 180000 });
  const result = await page.evaluate(() => {
    const lab = window.__bust;
    lab.pause(); lab.setAnim({ play: false }); lab.setTissue({ enabled: true });
    lab.setSliders({ size: 0.6, style: 0.5, lift: 0, spread: 0 });
    lab.resetMotion(); lab.step(1/60, 4);
    const rest = lab.tissueReport();
    lab.setAnim({ play: true, bob: 0.035, bobHz: 1.8 });
    let peak = 0, minDet = 1, maxVolumeError = 0, transferMin = 1, maxMs = 0;
    let minTransferScale=1, maxScaleChange=0, previousScale=1;
    const samples = [], bandPeaks = {tip:0,body:0,base:0,collar:0};
    for (let i = 0; i < 120; i++) {
      // Sample every simulated display frame without queueing 120 large
      // SwiftShader draws. The final state is rendered for the screenshot.
      lab.step(1/60, 1, false);
      const r = lab.tissueReport();
      peak = Math.max(peak, r.maxMappedDisplacement);
      minDet = Math.min(minDet, r.minDet);
      transferMin = Math.min(transferMin, r.transferMinDet);
      maxVolumeError = Math.max(maxVolumeError, ...r.zoneVolumeErrors.map(Math.abs));
      maxMs = Math.max(maxMs, r.ms);
      minTransferScale=Math.min(minTransferScale,r.transferScale);
      maxScaleChange=Math.max(maxScaleChange,Math.abs(r.transferScale-previousScale));
      previousScale=r.transferScale;
      for(const [key,band] of Object.entries(r.motionBands)) bandPeaks[key]=Math.max(bandPeaks[key],band.mean);
      if ((i + 1) % 15 === 0) samples.push({ displacement:r.maxMappedDisplacement, volume:r.volumeError, minDet:r.minDet, scale:r.transferScale });
    }
    lab.setAnim({ play: false }); lab.step(1/60, 240);
    const settled = lab.tissueReport();
    lab.setSliders({ size: -0.5 }); lab.step(1/60);
    const smallerReport = lab.tissueReport(), smallerVolume = smallerReport.restVolume;
    lab.setSliders({ size: 0.6 }); lab.step(1/60);
    const largerReport = lab.tissueReport(), largerVolume = largerReport.restVolume;
    lab.setTissue({ enabled: false }); lab.step(1/60);
    const detached = !lab.tissueReport();
    lab.setTissue({ enabled: true }); lab.baselineDemo(); lab.step(1/60, 90);
    return { rest, peak, minDet, transferMin, maxVolumeError, maxMs, minTransferScale, maxScaleChange, bandPeaks, settled: { displacement:settled.maxMappedDisplacement,volume:settled.volumeError }, smallerVolume, largerVolume, smallerFootprint:smallerReport.proxy.region, largerFootprint:largerReport.proxy.region, detached, samples, current:lab.tissueReport() };
  });
  assert.deepEqual(errors, []);
  assert.equal(result.rest.nodeCount, 448);
  assert.equal(result.rest.tetCount, 1512);
  assert.ok(result.rest.mappedVertices > 0);
  assert.ok(result.rest.maxMappedDisplacement < 1e-7, 'authored rest stays unchanged');
  assert.ok(result.peak > 1e-4, 'driven cage is transferred to the rendered mesh');
  if(result.rest.motionBands.base.vertices>10) assert.ok(result.bandPeaks.base>result.bandPeaks.tip*0.1,'outer mound must respond, not just the tip');
  assert.ok(result.minDet >= 0.2 && result.transferMin >= 0.2, 'both tissue and displayed transfer retain positive local orientation');
  assert.ok(result.maxVolumeError < 0.05, `volume error ${result.maxVolumeError}`);
  assert.ok(result.settled.displacement < result.peak * 0.15, 'stopping body input settles tissue');
  assert.ok(result.largerVolume > result.smallerVolume * 1.01, `size sliders rebuild physical rest volume: ${result.smallerVolume} -> ${result.largerVolume}`);
  assert.deepEqual(result.smallerFootprint,result.largerFootprint,'size morphs do not reattach the chest to a different garment fold');
  assert.ok(result.detached, 'legacy comparison restores original render geometry');
  const name = path.basename(decodeURIComponent(model)).replace(/\.[^.]+$/, '');
  fs.writeFileSync(path.join(output, `${name}-tissue.json`), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, `${name}-tissue.png`), timeout:60000 });
  console.log(JSON.stringify({ model, peakS:result.peak, minDet:result.minDet, transferMin:result.transferMin, volumeError:result.maxVolumeError, settleS:result.settled.displacement, maxMs:result.maxMs, mapped:result.rest.mappedVertices,bandPeaks:result.bandPeaks,region:result.rest.proxy.region }));
} finally { await browser.close(); }
