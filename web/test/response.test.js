// Observable motion response: material frequency controls the spring, while
// the chest animation supplies the forcing. Neither is a separate jiggle clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BustDynamics } from '../src/core/runtime.js';

const FPS = 60;
const DT = 1 / FPS;
const pose = (y) => ({
  pos: [0, y, 0], left: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], S: 1,
});

test('a stationary chest never starts an independent oscillation', () => {
  for (const [frequency, damping] of [[0.5, 0.02], [2.4, 0.22], [6, 1]]) {
    const dynamics = new BustDynamics({ mapping: 'dedicated', frequency, damping });
    for (let i = 0; i <= 3 * FPS; i++) {
      const out = dynamics.update(i ? DT : 0, pose(1.2));
      for (const [name, value] of Object.entries({ ...out.modes, ...out.shapes })) {
        assert.equal(Math.abs(value), 0, `${name} moved at rest (natural frequency ${frequency})`);
      }
    }
  }
});

test('settled sinusoidal chest motion drives the animation frequency, with the analytic spring response', () => {
  const driveHz = 1.5, omega = 2 * Math.PI * driveHz;
  const amplitude = 0.02, damping = 0.3, gain = 1.2;
  for (const frequency of [0.75, 2.4, 4.5]) {
    const dynamics = new BustDynamics({ frequency, damping, gain, vskin: { enabled: false } });
    const samples = [];
    for (let i = 0; i < 12 * FPS; i++) {
      const t = i * DT;
      const out = dynamics.update(i ? DT : 0, pose(amplitude * Math.sin(omega * t)));
      // Eight seconds suppress the slowest free transient by more than 1e-4.
      // The remaining four seconds contain exactly six drive cycles.
      if (i >= 8 * FPS) samples.push({ t, q: out.modes.bounce });
    }

    // q'' + 2*zeta*wn*q' + wn^2*q = gain*A*omega^2*sin(omega*t).
    // This closed-form response is independent of the runtime integrator.
    const wn = 2 * Math.PI * frequency;
    const real = wn * wn - omega * omega, imag = 2 * damping * wn * omega;
    const force = gain * amplitude * omega * omega, denominator = real * real + imag * imag;
    const expectedSin = force * real / denominator;
    const expectedCos = -force * imag / denominator;
    const expectedAmplitude = Math.hypot(expectedSin, expectedCos);
    const sine = 2 * samples.reduce((s, x) => s + x.q * Math.sin(omega * x.t), 0) / samples.length;
    const cosine = 2 * samples.reduce((s, x) => s + x.q * Math.cos(omega * x.t), 0) / samples.length;
    const measuredAmplitude = Math.hypot(sine, cosine);
    const phaseError = Math.atan2(sine * expectedCos - cosine * expectedSin,
      sine * expectedSin + cosine * expectedCos);
    const residual = Math.sqrt(samples.reduce((s, x) => s +
      (x.q - sine * Math.sin(omega * x.t) - cosine * Math.cos(omega * x.t)) ** 2, 0) / samples.length);

    // At 60 fps the drive has 40 samples/cycle. Allow 1% for the sampled
    // chest interpolation and 0.01 rad (0.57 degrees) for its phase error.
    assert.ok(Math.abs(measuredAmplitude / expectedAmplitude - 1) < 0.01,
      `natural ${frequency} Hz: amplitude ${measuredAmplitude} vs ${expectedAmplitude}`);
    assert.ok(Math.abs(phaseError) < 0.01, `natural ${frequency} Hz: phase error ${phaseError}`);
    // A separate oscillation at the material frequency would remain here.
    assert.ok(residual < 0.01 * expectedAmplitude,
      `natural ${frequency} Hz: off-drive residual ${residual}`);
  }
});

test('holding the chest after a smooth excursion leaves only the damping envelope', () => {
  for (const [frequency, damping] of [[0.8, 0.15], [2.4, 0.22]]) {
    const dynamics = new BustDynamics({ frequency, damping, vskin: { enabled: false } });
    const alpha = damping * 2 * Math.PI * frequency;
    const wd = 2 * Math.PI * frequency * Math.sqrt(1 - damping * damping);
    const envelope = () => Math.hypot(dynamics.modal.q[0],
      (dynamics.modal.v[0] + alpha * dynamics.modal.q[0]) / wd);
    // One cosine excursion has zero displacement and velocity at both ends.
    // Allow three held samples to flush the tracker's interpolation history.
    const freeStart = FPS + 3;
    let initialEnvelope;
    for (let i = 0; i <= freeStart + 4 * FPS; i++) {
      const t = i * DT;
      const y = i < FPS ? 0.035 * (1 - Math.cos(2 * Math.PI * t)) / 2 : 0;
      dynamics.update(i ? DT : 0, pose(y));
      if (i === freeStart) {
        initialEnvelope = envelope();
        assert.ok(initialEnvelope > 1e-4, 'the excursion must excite a measurable response');
      } else if (i > freeStart) {
        const expected = initialEnvelope * Math.exp(-alpha * (i - freeStart) * DT);
        assert.ok(Math.abs(envelope() - expected) < 1e-8 * initialEnvelope,
          `natural ${frequency} Hz: response did not decay on its damping envelope`);
      }
    }
    assert.ok(envelope() < 0.05 * initialEnvelope, 'the held chest must settle');
  }
});
