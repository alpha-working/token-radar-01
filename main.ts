// Token Launch Radar — entry point (Node 22+, standard library only).
//
// Reads the sealed snapshot (default /input/snapshot.json, override with
// --input), ranks every pre-token protocol through the model in
// lib/model.ts, and writes the results to the output directory (default
// /output, override with --output or MAKEFUN_OUTPUT_DIR):
//   board.json    — the ranked board, as { rows }
//   data.js       — the same radar data as a script the dashboard loads
//   dashboard/    — a copy of this repo's static dashboard
//   screenshots/  — a copy of this repo's three screenshots
//   dossier.json  — the judge's summary, rebuilt from /output by the
//                   vendored make.fun library (written last, so its bytes
//                   always match a fresh rebuild of the same output).
//
// The dashboard never touches the network: it reads data.js only. This
// program makes no network calls either.
//
// Outside the grader, point the output somewhere writable, e.g.:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps from the scorer's reference/gate.json: the dossier text cap shapes
// the summary bytes, the screenshot caps refuse oversized images.
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Read a `--name value` or `--name=value` flag; fall back when absent. The
// separate form wins over the `=` form, and a bare `--name` at the very end
// of the arguments falls through to the `=` search, as before.
function flagValue(name: string, fallback: string): string {
  const separate = process.argv.indexOf(`--${name}`);
  if (separate !== -1 && separate + 1 < process.argv.length) {
    const next = process.argv[separate + 1];
    if (next !== undefined) return next;
  }
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

const inputFlag = flagValue('input', '/input');
const snapshotPath = inputFlag.endsWith('.json') ? inputFlag : path.join(inputFlag, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  process.stderr.write(`token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const radarResult = buildRadar(snapshot);
const board = radarResult.board;
const radar = radarResult.radar;
const gateIssue = boardIssue(board, snapshot);
if (gateIssue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${gateIssue}\n`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
fs.writeFileSync(path.join(outDir, 'data.js'), dataScript(radar));

// Copy the regular files of one directory into another, skipping hidden
// names (anything starting with a dot). Returns the copied names, in the
// order the directory lists them.
function copyRegularFiles(fromDir: string, toDir: string): string[] {
  if (!fs.existsSync(fromDir)) return [];
  fs.mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const name of fs.readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const source = path.join(fromDir, name);
    if (!fs.statSync(source).isFile()) continue;
    fs.copyFileSync(source, path.join(toDir, name));
    copied.push(name);
  }
  return copied;
}

copyRegularFiles(path.join(repoRoot, 'dashboard'), path.join(outDir, 'dashboard'));
const shots = copyRegularFiles(path.join(repoRoot, 'screenshots'), path.join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const shot of shots) {
  if (!SHOT_NAME.test(shot)) {
    process.stderr.write(`token radar: screenshots/${shot}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and
// compares bytes, so it must describe exactly what is on disk now.
fs.writeFileSync(
  path.join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${path.join(outDir, 'board.json')}, ${path.join(outDir, 'data.js')}, ${path.join(outDir, 'dashboard')} (3 files), ${path.join(outDir, 'screenshots')} (${shots.length} images) and ${path.join(outDir, 'dossier.json')}\n`,
);
