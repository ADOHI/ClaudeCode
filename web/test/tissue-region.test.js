import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTissueRegion } from '../src/core/tissue-region.js';
import { cloneParams, DEFAULT_PARAMS } from '../src/core/field.js';
import { synthTorso } from '../../tools/morpho/synth-torso.mjs';

function fit(shape = {}, excluded = false) {
  const s = synthTorso({ h:0.01, flatChest:true, k:0.004, aLat:0.2, aMed:0.18, bUp:0.2, bLo:0.22, P:0.23, ...shape });
  const params=cloneParams(DEFAULT_PARAMS);
  // Deliberately wrong static-brush depth: the fitter must use the geometry.
  params.anchor={x:0.27,y:0.27,z:0.43};
  const mesh={pos:s.pos,index:s.index,mask:excluded ? new Float32Array(s.pos.length/3) : null};
  return fitTissueRegion({frame:s.frame,params,meshes:[mesh]});
}

test('tissue region recovers the whole mound and chest wall independently of the morph brush depth',()=>{
  const region=fit();
  for(const s of region.sides) {
    assert.equal(s.method,'surface-sections');
    assert.ok(Math.abs(s.wall-0.14)<0.02, `wall ${s.wall}`);
    assert.ok(Math.abs(s.outer-0.47)<0.035, `lateral border ${s.outer}`);
    assert.ok(Math.abs(s.bottom-0.05)<0.03, `bottom ${s.bottom}`);
    assert.ok(Math.abs(s.top-0.47)<0.03, `top ${s.top}`);
    assert.ok(Math.abs(s.peak-0.41)<0.01);
  }
  for(const key of ['centerU','cy','inner','outer','bottom','top','wall','peak']) assert.ok(Math.abs(region.sides[0][key]-region.sides[1][key])<1e-8,key);
});

test('a broader source mound expands the fitted footprint, rather than only moving the apex',()=>{
  const small=fit(), large=fit({aLat:0.27,bUp:0.27,bLo:0.28,P:0.28});
  for(let i=0;i<2;i++) {
    assert.ok(large.sides[i].outer>small.sides[i].outer+0.04);
    assert.ok(large.sides[i].top>small.sides[i].top+0.04);
    assert.ok(large.sides[i].bottom<small.sides[i].bottom-0.03);
  }
});

test('missing anatomical surface is reported as a prior, not a successful fitted radius',()=>{
  for(const s of fit({},true).sides) {
    assert.equal(s.method,'prior');
    assert.ok(s.warnings.includes('noSurface'));
    assert.ok(['centerU','cy','inner','outer','bottom','top','wall','peak'].every(k=>Number.isFinite(s[k])));
  }
});
