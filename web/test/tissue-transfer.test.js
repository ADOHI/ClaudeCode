import test from 'node:test';
import assert from 'node:assert/strict';
import {detCoefficients,safeTransferScale} from '../src/core/tissue-transfer.js';
import {m3Det} from '../src/core/vec.js';

test('transfer polynomial agrees with direct determinants under shear and compression',()=>{
  for(const a of [[-2,0.2,0.3,0.1,-0.4,0,0.1,0.2,0.5],[0,1,0,-0.6,0,0.2,0.4,0,0]]) {
    const c=detCoefficients(a);
    for(const s of [0,0.13,0.5,0.97,1]) {
      const f=a.map((v,i)=>s*v+([0,4,8].includes(i)?1:0));
      assert.ok(Math.abs(m3Det(f)-(1+s*(c[0]+s*(c[1]+s*c[2]))))<1e-12);
    }
  }
});

test('a changing compression has a continuous safety limit, without half-amplitude steps',()=>{
  let prior=1;
  for(let compression=0.7;compression<=2;compression+=0.01) {
    const limit=safeTransferScale(detCoefficients([-compression,0,0,0,0,0,0,0,0]));
    assert.ok(Math.abs(limit-Math.min(1,0.75/compression))<0.00025);
    assert.ok(1-compression*limit>=0.25-1e-12);
    assert.ok(Math.abs(limit-prior)<0.015);
    prior=limit;
  }
  assert.equal(safeTransferScale([0,0,0]),1);
  // A double-axis compression has a positive endpoint but collapses halfway.
  // A recovering scale must stay on the connected safe interval from zero.
  const foldedPath=safeTransferScale(detCoefficients([-2,0,0,0,-2,0,0,0,0]));
  assert.ok(Math.abs(foldedPath-0.25)<0.00025);
});
