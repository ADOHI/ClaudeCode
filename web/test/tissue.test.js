import test from 'node:test';
import assert from 'node:assert/strict';
import { TissueVolume } from '../src/core/tissue.js';
import { ChestTracker } from '../src/core/runtime.js';

function block(scale = 1, fixedBack = true) {
  const p = [], t = [], fixed = [], n = 3;
  const id = (x, y, z) => (z * n + y) * n + x;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    p.push((x - 1) * 0.15 * scale, (y - 1) * 0.15 * scale, z * 0.15 * scale);
    fixed.push(+(fixedBack && z === 0));
  }
  const split = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]];
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const c = [id(x,y,z),id(x+1,y,z),id(x,y+1,z),id(x+1,y+1,z),id(x,y,z+1),id(x+1,y,z+1),id(x,y+1,z+1),id(x+1,y+1,z+1)];
    for (const tet of split) t.push(...tet.map(i => c[i]));
  }
  return { positions: p, tets: t, fixed };
}

const rms = a => Math.sqrt(a.reduce((s,x) => s+x*x, 0) / a.length);

test('distributed tissue preserves authored rest and attached back nodes', () => {
  const tissue = new TissueVolume(block());
  for (let i = 0; i < 20; i++) tissue.update(1/60);
  assert.ok(rms(tissue.displacements) < 1e-12);
  for (let i = 0; i < 90; i++) tissue.update(1/120, { acceleration:[0,5,0] });
  for (let n = 0; n < tissue.nodeCount; n++) if (tissue.fixed[n]) assert.deepEqual(Array.from(tissue.positions.slice(n*3,n*3+3)), Array.from(tissue.restPositions.slice(n*3,n*3+3)));
  const s = tissue.report();
  assert.ok(s.touchedNodes > 10 && s.minDet > 0.2);
  assert.ok(Math.abs(s.volumeError) < 0.03, `volume change ${s.volumeError}`);
  // Different depth layers deform differently: this cannot be one rigid grab.
  const mid = Math.abs(tissue.displacements[13*3+1]), front = Math.abs(tissue.displacements[22*3+1]);
  assert.ok(front > mid * 1.15, `front ${front}, mid ${mid}`);
});

test('rotationally invariant strain produces no restoring distortion under rigid rotation', () => {
  const tissue = new TissueVolume({ ...block(1,false), maxDisplacement:1 });
  const angle=.12, c=Math.cos(angle), s=Math.sin(angle);
  for (let i=0;i<tissue.positions.length;i+=3) {
    const x=tissue.positions[i], y=tissue.positions[i+1];
    tissue.positions[i]=c*x-s*y; tissue.positions[i+1]=s*x+c*y;
  }
  const rotated=tissue.positions.slice(); tissue.update(1/60);
  assert.ok(tissue.positions.every((x,i)=>Math.abs(x-rotated[i])<1e-11));
});

test('a driven volume has damped residual deformation and size-dependent inertia', () => {
  const small=new TissueVolume(block()), large=new TissueVolume(block(1.8));
  let peaks=[0,0];
  for(let i=0;i<60;i++) [small,large].forEach((s,k)=>{s.update(1/120,{acceleration:[0,4*Math.sin(Math.PI*i/60),0]});peaks[k]=Math.max(peaks[k],rms(s.displacements));});
  assert.ok(peaks[1]>peaks[0]*1.2, `${peaks}`);
  const before=rms(small.displacements);
  for(let i=0;i<360;i++) small.update(1/120);
  assert.ok(rms(small.displacements)<before*.05);
});

test('strong inputs remain finite with explicit safety counters and cuts clear velocity', () => {
  const tissue=new TissueVolume(block());
  for(let i=0;i<50;i++) tissue.update(1/60,{acceleration:[30,-40,20],angularVelocity:[1,2,1]},{exaggeration:2.5});
  const report=tissue.report();
  assert.ok(tissue.positions.every(Number.isFinite)); assert.ok(report.minDet>=tissue.material.minDet);
  assert.ok(report.maxStrain<=tissue.material.maxStrain+1e-8);
  tissue.impulse([1,0,0],[0,1,0]);
  assert.ok(tissue.velocities.some(v=>v!==0));
  tissue.update(1,{cut:true});
  assert.equal(rms(tissue.displacements),0); assert.equal(rms(tissue.velocities),0);
  assert.ok(tissue.report().resets>0);
});

test('the same continuous chest motion agrees at 30, 60 and 120 display fps', () => {
  const axes = [[1,0,0], [0,1,0], [0,0,1]];
  const runs = [30,60,120].map(fps => {
    const tissue = new TissueVolume({ ...block(), iterations:3 }), tracker = new ChestTracker();
    const samples = [];
    for (let i=0;i<=fps*3;i++) {
      // A cosine excursion starts at zero velocity, and continues at 1.5 Hz.
      const time=i/fps, y=0.012*(1-Math.cos(2*Math.PI*1.5*time));
      const tracked=tracker.push(i ? 1/fps : 0,[0,y,0],axes,1,[0,0,0],axes);
      for (const step of tracked.steps ?? []) tissue.advanceTracked(step);
      if (i>=fps && i % (fps/30) === 0) samples.push(...tissue.displacements);
    }
    return samples;
  });
  const reference=runs[2], amplitude=rms(reference);
  assert.ok(amplitude>1e-4, 'the motion must excite measurable tissue deformation');
  for (const samples of runs.slice(0,2)) {
    const error=rms(samples.map((v,i)=>v-reference[i]))/amplitude;
    assert.ok(error<0.05, `normalized trajectory error ${error}`);
  }
});
