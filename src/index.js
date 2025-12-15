// src/index.js
// Usage: node src/index.js [--startSeed=0] [--maxSeeds=1000000] [--step=1]
// Writes winning_seeds.txt in repo root.

const fs = require('fs');
const path = require('path');
const { simulateChompstep } = require('./simulator');

function parseArg(name, fallback) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const v = arg.split('=')[1];
  return isNaN(Number(v)) ? v : Number(v);
}

const startSeed = parseArg('startSeed', 0) >>> 0;
const maxSeeds = parseArg('maxSeeds', 200000) >>> 0;
const step = parseArg('step', 1) >>> 0;
const outputPath = path.resolve(process.cwd(), 'winning_seeds.txt');

console.log(`Chompstep seed finder — testing seeds ${startSeed} .. ${startSeed + maxSeeds - 1} step ${step}`);

const winners = [];
let tested = 0;
const t0 = Date.now();

for (let s = startSeed; s < startSeed + maxSeeds; s += step) {
  tested++;
  const ok = simulateChompstep(s >>> 0);
  if (ok) winners.push(s >>> 0);
  if (tested % 100000 === 0) {
    const elapsed = (Date.now() - t0) / 1000;
    console.log(`tested ${tested} seeds — winners: ${winners.length} — elapsed ${elapsed.toFixed(1)}s`);
  }
}

const header = `# Chompstep winning seeds (modeled: 35 independent 50/50 kills)\n# Generated: ${new Date().toISOString()}\n# Seeds tested: ${tested}\n\n`;
const body = winners.length ? winners.map(s => String(s)).join('\n') + '\n' : 'NO WINNING SEEDS FOUND\n';
fs.writeFileSync(outputPath, header + body, 'utf8');

console.log(`Done. Tested ${tested} seeds, winners found: ${winners.length}. Output: ${outputPath}`);
