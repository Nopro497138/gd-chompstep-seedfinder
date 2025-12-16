// src/index.js
// Robust entrypoint: accepts --levelId, --startSeed, --maxSeeds, --step, --workers
// - Streams results to winning_seeds.txt (no big arrays)
// - Uses Worker Threads for parallelization if requested/beneficial
// - Caps maxSeeds to a safe maximum to avoid accidental huge allocations

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const { fetchAndDecodeLevel } = require('./level_fetcher');
const { simulateGeneric } = require('./simulator');

function parseArg(name, fallback) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  if (!a) return fallback;
  const v = a.split('=')[1];
  return isNaN(Number(v)) ? v : Number(v);
}

// Safety caps
const MAX_SAFE_SEEDS = 5_000_000; // absolute hard cap to avoid insane runs
const DEFAULT_MAX_SEEDS = 200_000;

(async () => {
  const levelId = parseArg('levelId', null);
  let startSeed = (parseArg('startSeed', 0) >>> 0);
  let maxSeeds = (parseArg('maxSeeds', DEFAULT_MAX_SEEDS) >>> 0);
  const step = Math.max(1, (parseArg('step', 1) >>> 0));
  const requestedWorkers = parseArg('workers', 0) >>> 0; // 0 = auto decision
  const outputPath = path.resolve(process.cwd(), 'winning_seeds.txt');

  if (maxSeeds > MAX_SAFE_SEEDS) {
    console.warn(`Requested maxSeeds ${maxSeeds} exceeds safety cap ${MAX_SAFE_SEEDS}. Reducing to cap.`);
    maxSeeds = MAX_SAFE_SEEDS;
  }

  console.log(`Configuration -> levelId=${levelId ?? 'none'}, startSeed=${startSeed}, maxSeeds=${maxSeeds}, step=${step}`);

  // Build model (same heuristic logic as before)
  let model = { numChecks: 35, p: 0.5, note: 'default 35x50%' };

  if (levelId) {
    try {
      const info = await fetchAndDecodeLevel(String(levelId));
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const rawPath = path.join(dataDir, `level_${levelId}.raw.txt`);
      fs.writeFileSync(rawPath, info.raw || '', 'utf8');
      if (info.decoded) {
        const decPath = path.join(dataDir, `level_${levelId}.decoded.txt`);
        fs.writeFileSync(decPath, info.decoded, 'utf8');
      }

      if (String(levelId) === '122149930') {
        model = { numChecks: 35, p: 0.5, note: 'Chompstep special-case (35 independent 50% checks)' };
        console.log('Chompstep detected: using 35×50% model.');
      } else if (info.decoded && info.decoded.length > 0) {
        // modest heuristic; keep numbers small to avoid huge runtime
        const decoded = info.decoded;
        const tokensBySemicolon = (decoded.match(/;/g) || []).length;
        const tokensByPipe = (decoded.match(/\|/g) || []).length;
        const tokensByComma = (decoded.match(/,/g) || []).length;
        const approxObjects = Math.max(tokensBySemicolon, tokensByPipe, Math.floor(tokensByComma / 8), 1);
        const numChecks = Math.max(1, Math.min(200, Math.floor(approxObjects / 10)));
        model = { numChecks, p: 0.5, note: `heuristic based on decoded length (approxObjects=${approxObjects})` };
        console.log(`Heuristic model: numChecks=${numChecks} (approxObjects=${approxObjects})`);
      } else {
        model = { numChecks: 10, p: 0.5, note: 'fallback heuristic (no decoded data)' };
      }
    } catch (err) {
      console.error('Level fetch/decoding failed:', err && err.message ? err.message : err);
      model = { numChecks: 10, p: 0.5, note: 'fallback due to fetch/decode error' };
    }
  } else {
    model = { numChecks: 35, p: 0.5, note: 'default (no levelId supplied)' };
  }

  // Prepare output file stream (write header first)
  const outStream = fs.createWriteStream(outputPath, { flags: 'w', encoding: 'utf8' });
  outStream.write(`# Winning seeds\n# LevelId: ${levelId ?? 'none'}\n# Model: ${model.numChecks} checks @ p=${model.p} (${model.note})\n# Generated: ${new Date().toISOString()}\n# Seeds tested: ${maxSeeds}\n\n`);
  // We'll append winners as we find them.

  // Decide whether to use workers:
  const cpuCount = Math.max(1, os.cpus().length || 1);
  let workers = 0;
  if (maxSeeds <= 100000 || step > 1) {
    workers = 0; // serial is fine for small jobs or stepped scans
  } else if (requestedWorkers > 0) {
    workers = Math.min(requestedWorkers, cpuCount, 8);
  } else {
    // Auto: use min(cpuCount, 4) but don't oversubscribe for small runs
    workers = Math.min(cpuCount, 4);
  }

  // Serial path (no workers)
  if (workers <= 1) {
    console.log('Running serial seed scan (no worker threads).');
    let tested = 0;
    const t0 = Date.now();

    for (let s = startSeed; s < startSeed + maxSeeds; s += step) {
      tested++;
      try {
        const ok = simulateGeneric(s >>> 0, model.numChecks, model.p);
        if (ok) {
          outStream.write(String(s >>> 0) + '\n');
        }
      } catch (e) {
        console.error(`Simulation error at seed ${s}:`, e && e.message ? e.message : e);
      }
      if (tested % 100000 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        console.log(`Tested ${tested} seeds — elapsed ${elapsed.toFixed(1)}s`);
      }
    }

    outStream.end();
    console.log('Serial run complete.');
    return;
  }

  // Parallel path: spawn workers and stream winners as they arrive
  console.log(`Running parallel seed scan with ${workers} workers.`);

  const seedsPerWorker = Math.ceil(maxSeeds / workers);
  let activeWorkers = 0;
  let totalTested = 0;
  const t0 = Date.now();

  // simple helper to spawn a worker for a given seed range
  function spawnWorker(workerIndex, wStartSeed, wMaxSeeds) {
    activeWorkers++;
    const workerData = {
      startSeed: wStartSeed >>> 0,
      maxSeeds: wMaxSeeds >>> 0,
      step: step >>> 0,
      model
    };
    const workerFile = path.join(__dirname, 'worker.js');
    const w = new Worker(workerFile, { workerData });

    w.on('message', (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'winner') {
        // write winner line
        outStream.write(String(msg.seed >>> 0) + '\n');
      } else if (msg.type === 'progress') {
        // aggregated progress info
        totalTested += msg.deltaTested || 0;
        // occasionally log
        if ((totalTested % 100000) < (msg.deltaTested || 0)) {
          const elapsed = (Date.now() - t0) / 1000;
          console.log(`Progress: tested ~${totalTested} seeds — elapsed ${elapsed.toFixed(1)}s`);
        }
      }
    });

    w.on('error', (err) => {
      console.error(`Worker ${workerIndex} error:`, err && err.message ? err.message : err);
    });

    w.on('exit', (code) => {
      activeWorkers--;
      if (code !== 0) {
        console.warn(`Worker ${workerIndex} exited with code ${code}`);
      } else {
        console.log(`Worker ${workerIndex} finished.`);
      }
      if (activeWorkers === 0) {
        outStream.end();
        const elapsed = (Date.now() - t0) / 1000;
        console.log(`All workers finished. Total tested (approx): ${totalTested}. Elapsed ${elapsed.toFixed(1)}s`);
      }
    });
  }

  // spawn workers with non-overlapping ranges
  let assigned = 0;
  for (let i = 0; i < workers; i++) {
    const wStart = startSeed + assigned * step;
    // compute remaining seeds
    const remainingSeeds = Math.max(0, maxSeeds - assigned);
    const take = Math.min(seedsPerWorker, remainingSeeds);
    if (take <= 0) break;
    assigned += take;
    spawnWorker(i + 1, wStart, take);
  }

})();
