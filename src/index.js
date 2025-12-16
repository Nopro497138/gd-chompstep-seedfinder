// src/index.js
// Entry: accepts either a levelId or runs direct simulation (like before).
//
// Usage examples:
//  node src/index.js --levelId=122149930 --startSeed=0 --maxSeeds=200000 --step=1
//  node src/index.js --startSeed=0 --maxSeeds=200000 --step=1

const fs = require('fs');
const path = require('path');
const { fetchAndDecodeLevel } = require('./level_fetcher');
const { simulateGeneric } = require('./simulator');

function parseArg(name, fallback) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  if (!a) return fallback;
  const v = a.split('=')[1];
  return isNaN(Number(v)) ? v : Number(v);
}

(async () => {
  const levelId = parseArg('levelId', null);
  const startSeed = (parseArg('startSeed', 0) >>> 0);
  const maxSeeds = (parseArg('maxSeeds', 200000) >>> 0);
  const step = (parseArg('step', 1) >>> 0);
  const outputPath = path.resolve(process.cwd(), 'winning_seeds.txt');

  console.log(`Seed finder start. startSeed=${startSeed}, maxSeeds=${maxSeeds}, step=${step}, levelId=${levelId ?? '(none)'}`);

  let model = {
    numChecks: 35,
    p: 0.5,
    note: 'default: 35x50% (Chompstep fallback)'
  };

  if (levelId) {
    try {
      const info = await fetchAndDecodeLevel(String(levelId));
      // Save fetched files under data/
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const rawPath = path.join(dataDir, `level_${levelId}.raw.txt`);
      fs.writeFileSync(rawPath, info.raw || '', 'utf8');
      console.log(`Saved raw level response to ${rawPath}`);
      if (info.decoded) {
        const decPath = path.join(dataDir, `level_${levelId}.decoded.txt`);
        fs.writeFileSync(decPath, info.decoded, 'utf8');
        console.log(`Saved decoded level data to ${decPath}`);
      } else {
        console.log('No decoded payload available for this level (decoding failed or not provided).');
      }

      // Heuristic: If level is Chompstep (special-case), use 35×50%
      if (String(levelId) === '122149930') {
        model = { numChecks: 35, p: 0.5, note: 'Chompstep special-case (35 independent 50% checks)' };
        console.log('Detected Chompstep ID: using 35×50% model.');
      } else {
        // General heuristic: estimate number of checks from decoded length / object-like tokens
        if (info.decoded && info.decoded.length > 0) {
          // crude heuristics:
          const decoded = info.decoded;
          // estimate object-like tokens by counting semicolons or pipes or commas
          const tokensBySemicolon = (decoded.match(/;/g) || []).length;
          const tokensByPipe = (decoded.match(/\|/g) || []).length;
          const tokensByComma = (decoded.match(/,/g) || []).length;
          const approxObjects = Math.max(tokensBySemicolon, tokensByPipe, Math.floor(tokensByComma / 8), 1);
          // convert to number of RNG checks: assume ~1 check per 10 objects (very rough)
          const numChecks = Math.max(1, Math.min(200, Math.floor(approxObjects / 10)));
          model = { numChecks, p: 0.5, note: `heuristic based on decoded length (approxObjects=${approxObjects})` };
          console.log(`Heuristic model derived: numChecks=${numChecks} (approxObjects=${approxObjects})`);
        } else {
          // fallback mild default
          model = { numChecks: 10, p: 0.5, note: 'fallback heuristic (no decoded data)' };
          console.log('Falling back to default heuristic: 10 checks × 50%');
        }
      }
    } catch (err) {
      console.error('Error while fetching/decoding level:', err);
      console.log('Falling back to default model: 10 checks × 50%');
      model = { numChecks: 10, p: 0.5, note: 'fallback due to fetch/decode error' };
    }
  } else {
    // No level ID provided — keep previous default (Chompstep-like unless user changed)
    console.log('No levelId provided. To fetch leveldata, pass --levelId=<id>');
    model = { numChecks: 35, p: 0.5, note: 'default model (35x50%)' };
  }

  console.log('Simulation model:', model);

  const winners = [];
  let tested = 0;
  const t0 = Date.now();

  for (let s = startSeed; s < startSeed + maxSeeds; s += step) {
    tested++;
    const ok = simulateGeneric(s >>> 0, model.numChecks, model.p);
    if (ok) winners.push(s >>> 0);
    if (tested % 100000 === 0) {
      const elapsed = (Date.now() - t0) / 1000;
      console.log(`tested ${tested} seeds — winners: ${winners.length} — elapsed ${elapsed.toFixed(1)}s`);
    }
  }

  const header = `# Winning seeds\n# LevelId: ${levelId ?? 'none'}\n# Model: ${model.numChecks} checks @ p=${model.p} (${model.note})\n# Generated: ${new Date().toISOString()}\n# Seeds tested: ${tested}\n\n`;
  const body = winners.length ? winners.map(s => String(s)).join('\n') + '\n' : 'NO WINNING SEEDS FOUND\n';
  fs.writeFileSync(outputPath, header + body, 'utf8');

  console.log(`Done. Tested ${tested} seeds, winners found: ${winners.length}. Output: ${outputPath}`);
})();
