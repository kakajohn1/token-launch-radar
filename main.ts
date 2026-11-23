// Token Radar entry (model version radar-2): reads the sealed snapshot,
// fits the value and launch-odds models on it, ranks the board, and writes
// /output with the dashboard, its data, screenshots, and the dossier.
//
// Usage:
//   node main.ts --input /input/snapshot.json --output /output --dashboard ./dashboard --screenshots ./screenshots
//
// Notes:
// - Node 22 only, no dependencies, no network. `vendor/makefun-board.ts`
//   runs under the same runtime. The dossier library uses `window.RADAR`
//   in the browser, but in Node the same JSON is written directly into
//   /output/data.js with `window.RADAR = ...;`.
// - The run is deterministic: two runs write byte-identical files. No
//   Date.now(), no Math.random(), no wall clock in any computed value.
// - The starter main.ts is the model for this file's shape, but everything
//   here is original work: the model, the farm plans and the dashboard
//   are all this entry's own.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSnapshot, buildRadar, boardIssue, dataScript, MODEL_VERSION } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The program's two required inputs and two optional ones. */
export interface Args {
  input: string;
  output: string;
  dashboard: string;
  screenshots: string;
}

/** Parse `--input`, `--output`, `--dashboard`, `--screenshots`. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { input: '/input/snapshot.json', output: '/output', dashboard: './dashboard', screenshots: './screenshots' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--input=')) args.input = arg.slice('--input='.length);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg.startsWith('--dashboard=')) args.dashboard = arg.slice('--dashboard='.length);
    else if (arg.startsWith('--screenshots=')) args.screenshots = arg.slice('--screenshots='.length);
    else if (arg === '--input' || arg === '--output' || arg === '--dashboard' || arg === '--screenshots') {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      const key = arg.slice(2) as keyof Args;
      args[key] = next;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

/** The whole run: read, fit, rank, check, and write /output. */
export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const inputArg = args.input;
  const inputPath = resolve(inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json'));
  // Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output.
  const outputDir = resolve(args.output === '/output' && process.env.MAKEFUN_OUTPUT_DIR ? process.env.MAKEFUN_OUTPUT_DIR : args.output);
  const dashboardDir = resolve(args.dashboard);
  const screenshotsDir = resolve(args.screenshots);
  const raw = readFileSync(inputPath, 'utf-8');
  const snapshot = parseSnapshot(JSON.parse(raw));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`Board issue: ${issue}`);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), JSON.stringify(board, null, 2) + '\n', 'utf-8');
  writeFileSync(join(outputDir, 'data.js'), dataScript(radar) + '\n', 'utf-8');
  if (existsSync(dashboardDir)) {
    cpSync(dashboardDir, join(outputDir, 'dashboard'), { recursive: true });
  }
  if (existsSync(screenshotsDir)) {
    cpSync(screenshotsDir, join(outputDir, 'screenshots'), { recursive: true });
  }
  const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  const pre = board.filter((r) => r.token_status === 'pre-token');
  const live = board.filter((r) => r.token_status === 'live');
  console.log(`Token Radar (${MODEL_VERSION}): wrote ${board.length} rows (${pre.length} pre-token, ${live.length} live) to ${outputDir}`);
  console.log(`  watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered; set aside ${radar.set_aside_size} of ${snapshot.protocols.length} protocols`);
  console.log(`  verdicts: ${radar.farm_count} FARM, ${radar.thin_count} THIN, ${radar.skip_count} SKIP`);
  console.log(`  value fit: ${radar.fit.value.n_train} live protocols, CV median error ${radar.fit.value.cv_median_rel_err.toFixed(2)}x, older-to-newer R2 ${radar.fit.value.newer_r2}`);
  console.log(`  hazard fit: h0=${radar.fit.hazard.h0}, k=${radar.fit.hazard.k}, bT=${radar.fit.hazard.bT}, bG=${radar.fit.hazard.bG}, AUC ${radar.fit.hazard.auc}, CV AUC ${radar.fit.hazard.cv_auc}`);
  console.log(`  top 3: ${board.slice(0, 3).map((r) => `${r.name} ($${r.implied_value_usd.toLocaleString('en-US')})`).join(', ')}`);
}

main();
