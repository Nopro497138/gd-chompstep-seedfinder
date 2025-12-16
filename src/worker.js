// src/worker.js
// Executed inside a Worker thread. Receives workerData with { startSeed, maxSeeds, step, model }.
// Posts messages back: { type: 'winner', seed } and periodic { type: 'progress', deltaTested }.

const { parentPort, workerData } = require('worker_threads');
const { simulateGeneric } = require('./simulator');

if (!workerData) {
  parentPort.postMessage({ type: 'error', message: 'No workerData provided' });
  process.exit(1);
}

const startSeed = workerData.startSeed >>> 0;
const maxSeeds = workerData.maxSeeds >>> 0;
const step = Math.max(1, workerData.step >>> 0);
const model = workerData.model || { numChecks: 10, p: 0.5 };

let tested = 0;
const progressInterval = 10000; // report progress every N iterations

for (let i = 0; i < maxSeeds; i++) {
  const seed = (startSeed + i * step) >>> 0;
  try {
    const ok = simulateGeneric(seed, model.numChecks, model.p);
    if (ok) {
      parentPort.postMessage({ type: 'winner', seed });
    }
  } catch (e) {
    // Report and continue
    parentPort.postMessage({ type: 'error', message: `Sim error seed ${seed}: ${e && e.message ? e.message : e}` });
  }
  tested++;
  if (tested % progressInterval === 0) {
    parentPort.postMessage({ type: 'progress', deltaTested: progressInterval });
  }
}

// final progress post
if (tested % progressInterval !== 0) {
  parentPort.postMessage({ type: 'progress', deltaTested: tested % progressInterval });
}

process.exit(0);
