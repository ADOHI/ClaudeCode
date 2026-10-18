// A prescribed body motion used to excite the bust simulation. Its animation
// rate is independent of the material's natural frequency in BustDynamics.
const TAU = 2 * Math.PI;
const ARM_HZ = 0.18;
const RESPONSE = 16;
const FREQUENCY_RESPONSE = 12;

function rest(value = 0) {
  return { value, velocity: 0 };
}

// Exact critically damped response to a constant target over dt. Returning the
// integral lets the oscillator advance by the actual smoothed frequency rather
// than by frequency * total elapsed time (which jumps when a slider changes).
function smooth(state, target, dt, omega) {
  const offset = state.value - target;
  const slope = state.velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  const oneMinusDecay = -Math.expm1(-omega * dt);
  const integral = target * dt + offset * oneMinusDecay / omega
    + slope * (oneMinusDecay - omega * dt * decay) / (omega * omega);
  state.value = target + (offset + slope * dt) * decay;
  state.velocity = (state.velocity - omega * slope * dt) * decay;
  return integral;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export class DemoMotion {
  constructor() {
    this.reset();
  }

  reset() {
    this.bobPhase = 0;
    this.armPhase = 0;
    this.amplitude = rest();
    this.frequency = null;
    this.armEnvelope = rest();
  }

  // dt is real elapsed seconds. bob is a dimensionless displacement: the viewer
  // multiplies it by the body's shoulder span S, along the authored up axis.
  update(delta, { play = false, bob = 0.035, bobHz = 1.8, armCycle = false, armDown = 65 } = {}) {
    const dt = Math.max(0, finite(delta, 0));
    const hz = Math.max(0, finite(bobHz, 1.8));
    // The first requested rate is already the initial rate; later rate edits
    // retain both the current phase and the current frequency velocity.
    this.frequency ??= rest(hz);
    const cycles = smooth(this.frequency, hz, dt, FREQUENCY_RESPONSE);
    this.bobPhase = (this.bobPhase + TAU * cycles) % TAU;
    this.armPhase = (this.armPhase + TAU * ARM_HZ * dt) % TAU;
    smooth(this.amplitude, play ? Math.max(0, finite(bob, 0)) : 0, dt, RESPONSE);
    smooth(this.armEnvelope, play && armCycle ? 1 : 0, dt, RESPONSE);
    const down = finite(armDown, 65);
    const armExcursion = 0.5 - 0.5 * Math.cos(this.armPhase);
    return {
      bob: this.amplitude.value * Math.sin(this.bobPhase),
      // Manual posing is immediate. Only the animated excursion fades when
      // playback/cycling stops, so stopping cannot teleport the raised arms.
      armDown: down + (-80 - down) * this.armEnvelope.value * armExcursion,
    };
  }
}
