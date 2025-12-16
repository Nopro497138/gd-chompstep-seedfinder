// src/simulator.js
// RNG + generic simulator utilities.
// Exports simulateGeneric(seed, numChecks, p)

/* 32-bit LCG used as example RNG (Numerical Recipes style) */
function makeLCGRNG(seed) {
  let state = seed >>> 0;
  return {
    nextInt() {
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
 * simulateGeneric(seed, numChecks, p)
 * - Runs numChecks independent draws with probability p to 'survive' each check.
 * - Returns true if the run survives all checks.
 * - seed: 32-bit unsigned int
 */
function simulateGeneric(seed, numChecks = 10, p = 0.5) {
  const rng = makeLCGRNG(seed >>> 0);
  for (let i = 0; i < numChecks; i++) {
    const draw = rng.nextFloat();
    // We consider survival if draw >= p (so death chance is p). This matches earlier convention.
    // If you want the opposite semantics, invert the comparison.
    if (draw < p) return false; // died
  }
  return true; // survived all
}

module.exports = {
  simulateGeneric
};
