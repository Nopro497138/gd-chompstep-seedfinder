# Chompstep Seed Finder

This repo models Geometry Dash level "Chompstep" (ID: 122149930) as 35 independent 50/50 monster checks and searches seeds that survive all checks.

## Quickstart (local)
1. `npm install`
2. `node src/index.js --startSeed=0 --maxSeeds=200000 --step=1`
3. Output: `winning_seeds.txt` in the repo root.

## GitHub Actions
Use the workflow `Find Winning Seeds (Chompstep)` to run via `workflow_dispatch` with inputs:
- `startSeed`
- `maxSeeds`
- `step`

The workflow commits `winning_seeds.txt` to the same branch when finished (requires that branch protection does not block pushes from actions).

## Notes & how to adapt
- The simulation uses an example 32-bit LCG and models each monster as a single RNG float that kills with probability 0.5 if draw < 0.5.
- If you (or the community) provide a more accurate RNG model (exact engine LCG parameters, or the exact sequence/timing of RNG draws used by the level), edit `src/simulator.js`.
- For large ranges, split the search into chunks (use different `startSeed` on separate workflow runs) or add worker threads / parallel runners.
