// src/simulator.js
// RNG + generic simulator utilities. Keep small and robust.

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
 */
function simulateGeneric(seed, numChecks = 10, p = 0.5) {
  // argument sanity
  numChecks = Math.max(0, Math.min(10000, Math.floor(Number(numChecks) || 0)));
  p = Math.max(0, Math.min(1, Number(p) || 0.5));
  const rng = makeLCGRNG(seed >>> 0);
  for (let i = 0; i < numChecks; i++) {
    const draw = rng.nextFloat();
    if (draw < p) return false;
  }
  return true;
}

module.exports = {
  simulateGeneric
};
