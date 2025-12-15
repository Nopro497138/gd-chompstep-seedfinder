// src/simulator.js
// Simple Chompstep model: 35 sequential independent 50/50 "monster" checks.
// RNG: 32-bit LCG (Numerical Recipes style). For each monster we draw nextFloat() and
// consider 'death' if draw < 0.5 (this matches the 50% phrasing used by the community).

function makeLCGRNG(seed) {
  let state = seed >>> 0;
  return {
    nextInt() {
      // 32-bit LCG example
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    },
    nextFloat() {
      return (this.nextInt() >>> 0) / 4294967296;
    },
    getState() {
      return state >>> 0;
    }
  };
}

/**
 * simulateChompstep(seed)
 * Returns true if the seed survives all 35 independent 50% checks.
 * - seed: 32-bit unsigned integer
 */
function simulateChompstep(seed) {
  const NUM_MONSTERS = 35; // community model: 35 clubstep monsters each 50% chance to kill
  const rng = makeLCGRNG(seed);

  for (let i = 0; i < NUM_MONSTERS; i++) {
    const draw = rng.nextFloat();
    // Model choice: if draw < 0.5 => death (50%); otherwise survive
    // Note: you can invert semantics if community describes it differently.
    if (draw < 0.5) return false; // died at monster i
  }
  return true; // survived all monsters
}

module.exports = {
  simulateChompstep
};
