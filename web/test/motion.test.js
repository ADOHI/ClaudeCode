import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoMotion } from '../src/viewer/motion.js';

const near = (a, b, eps = 1e-11) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const playing = { play: true, bob: 0.035, bobHz: 1.8, armCycle: true, armDown: 65 };

function advance(motion, seconds, fps, options) {
  let pose;
  const count = Math.round(seconds * fps);
  for (let i = 0; i < count; i++) pose = motion.update(seconds / count, options);
  return pose;
}

test('animation follows one smooth sinusoid, with no abs(sin) velocity cusp', () => {
  const motion = new DemoMotion();
  // At a steady amplitude, a quarter-cycle is a positive peak and a
  // half-cycle is a smooth zero crossing, with the same velocity on both sides.
  motion.update(4, { ...playing, bobHz: 1 });
  const peak = motion.update(0.25, { ...playing, bobHz: 1 });
  near(peak.bob, playing.bob);
  const h = 1e-4;
  const before = motion.update(0.25 - h, { ...playing, bobHz: 1 }).bob;
  const middle = motion.update(h, { ...playing, bobHz: 1 }).bob;
  const after = motion.update(h, { ...playing, bobHz: 1 }).bob;
  near(middle, 0);
  near((middle - before) / h, (after - middle) / h, 1e-8);
  assert.ok(before > 0 && after < 0);
});

test('piecewise playback, amplitude and rate edits are independent of frame rate', () => {
  const schedule = [
    [0.5, { ...playing, play: false }],
    [0.5, playing],
    [1, { ...playing, bob: 0.08, bobHz: 3.3 }],
    [0.5, { ...playing, bob: 0.01, bobHz: 0.6 }],
    [0.5, { ...playing, play: false }],
    [1, { ...playing, bob: 0.04, bobHz: 2.1 }],
  ];
  const runs = [30, 60, 144].map(fps => {
    const motion = new DemoMotion();
    return schedule.map(([duration, options]) => advance(motion, duration, fps, options));
  });
  for (const run of runs.slice(1)) {
    for (let i = 0; i < run.length; i++) {
      near(run[i].bob, runs[0][i].bob);
      near(run[i].armDown, runs[0][i].armDown);
    }
  }
});

test('editing frequency or amplitude preserves position and velocity', () => {
  const baseline = new DemoMotion(), edited = new DemoMotion();
  advance(baseline, 1.25, 120, playing);
  const pose = advance(edited, 1.25, 120, playing);
  const change = { ...playing, bob: 0.11, bobHz: 0.5 };
  const atEdit = edited.update(0, change);
  near(atEdit.bob, pose.bob);
  near(atEdit.armDown, pose.armDown);
  // A small dt observes the same pre-edit tangent. An abrupt frequency * t
  // phase recomputation would produce a finite position jump here.
  const h = 1e-7;
  const normal = baseline.update(h, playing);
  const changed = edited.update(h, change);
  near((normal.bob - pose.bob) / h, (changed.bob - pose.bob) / h, 1e-5);
});

test('start is smooth and stop decays to the authored rest without snapping', () => {
  const motion = new DemoMotion();
  const rest = motion.update(0, playing);
  near(rest.bob, 0);
  near(rest.armDown, playing.armDown);
  const tiny = motion.update(1e-5, playing);
  assert.ok(Math.abs(tiny.bob) < 1e-10);
  advance(motion, 1.25 - 1e-5, 120, playing);
  const before = motion.update(0, playing);
  assert.ok(Math.abs(before.bob) > 0.01);
  assert.ok(Math.abs(before.armDown - playing.armDown) > 10);
  const stopping = { ...playing, play: false };
  const atStop = motion.update(0, stopping);
  near(atStop.bob, before.bob);
  near(atStop.armDown, before.armDown);
  const oneFrame = motion.update(1 / 120, stopping);
  assert.ok(Math.abs(oneFrame.bob) > 0.01, 'one frame must not reset the bob');
  assert.ok(Math.abs(oneFrame.armDown - playing.armDown) > 10, 'one frame must not reset the arms');
  const settled = advance(motion, 3, 120, stopping);
  near(settled.bob, 0);
  near(settled.armDown, playing.armDown);
});

test('arm cycle has a persistent phase and manual static poses remain exact', () => {
  const motion = new DemoMotion();
  for (const armDown of [-80, 0, 65, 85]) {
    assert.equal(motion.update(1 / 60, { armDown }).armDown, armDown);
  }
  const pose = advance(motion, 1, 60, playing);
  const changed = motion.update(0, { ...playing, bobHz: 4 });
  near(changed.armDown, pose.armDown);
  motion.reset();
  assert.deepEqual(motion.update(0, playing), { bob: 0, armDown: playing.armDown });
});

test('invalid elapsed time does not advance motion and a long frame settles analytically', () => {
  const motion = new DemoMotion();
  const initial = motion.update(0, playing);
  for (const dt of [-1, NaN, Infinity]) assert.deepEqual(motion.update(dt, playing), initial);
  const longFrame = motion.update(10, { ...playing, bobHz: 1 });
  assert.ok(Number.isFinite(longFrame.bob) && Number.isFinite(longFrame.armDown));
  const stopped = motion.update(10, { ...playing, play: false });
  near(stopped.bob, 0);
  near(stopped.armDown, playing.armDown);
});
