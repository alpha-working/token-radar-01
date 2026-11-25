// The Launch Ledger — radar-5 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the value multiple and the token odds on the
// snapshot's own record, ranks every rankable pre-token protocol, and writes
// the board, the dashboard's data, the evidence for the fits, and the dossier
// the judge reads. The program is deterministic: the same snapshot always
// writes the same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
//
// Screenshots are rendered after the first run (the dashboard must exist
// before it can be photographed); the second run, with three screenshots in
// screenshots/, writes the dossier as well.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLedger, boardIssue, dataScript, evidenceScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_MAX = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`launch ledger: ${message}\n`);
  process.exit(code);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, data, evidence } = buildLedger(snap);
const issue = boardIssue(board, snap);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(data));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyPlain(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyPlain(join(here, 'dashboard'), join(outDir, 'dashboard'));
// The evidence is generated from this run's fits, so it is written fresh over the committed copy.
writeFileSync(join(outDir, 'dashboard', 'evidence.js'), evidenceScript(evidence));

const shots = copyPlain(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: render 3 first — the board, a detail view and a filtered view — then run again`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: SHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const top = board.slice(0, 5).map((r) => `#${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ');
const v = evidence.value;
const o = evidence.odds;
process.stdout.write(
  `launch ledger: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `launch ledger: value multiple fitted on ${v.n} traded tokens — leave-one-out x${v.looMiss.toFixed(2)}, walk-forward x${v.wfSingleMiss.toFixed(2)}\n` +
    `launch ledger: token odds fitted on ${o.n} peers (base rate ${o.baseRate.toFixed(3)}) — ten-fold Brier ${o.tenFold.toFixed(3)}, walk-forward ${o.wfMulti.toFixed(3)}\n` +
    `launch ledger: range honesty, measured claim: ${Math.round(v.claim2575 * 100)}% inside P25-P75, ${Math.round(v.claim1090 * 100)}% inside P10-P90 (walk-forward check ${Math.round(v.wfCover2575 * 100)}% / ${Math.round(v.wfCover1090 * 100)}%)\n` +
    `launch ledger: ledger ${evidence.ledger.reduce((s, g) => s + g.count, 0)} of ${snap.protocols.length} protocols in ${evidence.ledger.length} groups\n` +
    `launch ledger: farm verdicts — ${evidence.verdicts.farm} FARM, ${evidence.verdicts.marginal} MARGINAL, ${evidence.verdicts.skip} SKIP\n` +
    `launch ledger: top 5: ${top}\n` +
    `launch ledger: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} and ${join(outDir, 'dossier.json')}\n`,
);
