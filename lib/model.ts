// The Launch Ledger's model: radar-4.
//
// One snapshot of the protocol universe in, one ranked board out. The value
// multiple and the token odds are both fitted on the snapshot's own record and
// both tested held-out two ways before a single term is kept; the page prints
// the tests, not just the winners. Nothing here names a protocol: every rule
// reads the snapshot's own fields (TVL, 7-day change, listed date, category,
// chains, whether a token is recorded), and the board's set is every protocol
// the watchlist's own rules leave rankable.
//
//   value   log(mcap/tvl) ~ median regression on ln TVL, its square, the
//           chain count and a shrunk category effect; 95 traded tokens.
//   odds    logit P(records a token) ~ log age, a shrunk category effect and
//           a shrunk first-chain effect; 442 peers listed a year or more.
//   implied TVL x fitted multiple x token odds. A protocol the watchlist
//           leaves out only because its parent already records a token has
//           its odds halved: a stated assumption, not a fitted number, because
//           the snapshot holds no case that would fit it.
//   range   the leave-one-out residuals' quantiles, printed as P25-P75 and
//           P10-P90, with the walk-forward cover reported beside them.
//
// Deterministic: fixed iteration counts, no randomness, no clock. The same
// snapshot always yields the same board, byte for byte.

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export const MODEL_VERSION = 'radar-4';
const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the entry records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// ---------------------------------------------------------------- the watchlist's own rules

/** Categories the watchlist leaves out: products of a token that already trades, and exchanges. */
export const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a product's name may not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word that marks a product as wrapped or staked. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a release marker is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether the watchlist's own rules leave a protocol out for a visible reason:
 * its category, its name's wrapped/staked word, an exchange prefix, or a version marker.
 */
export function setAsideReason(p: Proto): string | null {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return p.category;
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  for (const ex of EXCHANGE_PREFIXES) if (p.name.startsWith(ex)) return 'exchange product';
  if (VERSIONED.test(p.name)) return 'versioned name';
  return null;
}

/** Whether the board may rank a protocol: pre-token and not set aside by the rules above. */
export function isRankable(p: Proto): boolean {
  return isPreToken(p) && setAsideReason(p) === null;
}

/**
 * Whether a protocol is off the watchlist only because its parent already records a token.
 * The snapshot carries no parent field, so this is found by elimination: pre-token, at or above
 * the floor, clean by every visible rule, yet not on the watchlist. The watchlist's own rules
 * leave no other reason. Twenty protocols in this snapshot are found this way.
 */
export function isParentRecorded(p: Proto, snap: Snap): boolean {
  if (!isPreToken(p)) return false;
  if (p.tvl_usd < snap.floor_usd) return false;
  if (setAsideReason(p) !== null) return false;
  return !snap.watchlist.includes(p.slug);
}

// ---------------------------------------------------------------- small linear algebra

/** Solve A x = b by Gaussian elimination with partial pivoting. A is square; b the same length. */
export function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => row.slice());
  const b = bIn.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (Math.abs(a[piv]![col]!) < 1e-12) throw new LedgerError('solveLinear: singular matrix');
    if (piv !== col) {
      const t = a[col]!;
      a[col] = a[piv]!;
      a[piv] = t;
      const tb = b[col]!;
      b[col] = b[piv]!;
      b[piv] = tb;
    }
    const d = a[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r]![c] = a[r]![c]! - f * a[col]![c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/**
 * Ridge fit: beta minimising ||X beta - y||^2 + sum pen[j] beta[j]^2.
 * X is rows x columns; pen is per column (0 = unpenalised).
 */
export function ridgeFit(x: number[][], y: number[], pen: number[]): number[] {
  const m = x.length;
  const n = x[0]!.length;
  const xtx: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const xty = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    const row = x[i]!;
    for (let j = 0; j < n; j++) {
      xty[j] = xty[j]! + row[j]! * y[i]!;
      for (let k = 0; k < n; k++) xtx[j]![k] = xtx[j]![k]! + row[j]! * row[k]!;
    }
  }
  for (let j = 0; j < n; j++) xtx[j]![j] = xtx[j]![j]! + pen[j]!;
  return solveLinear(xtx, xty);
}

/** The median (L1) fit: 8 rounds of reweighted ridge from the ridge start, weights 1/max(|r|, 0.2). */
export function medianFit(x: number[][], y: number[], pen: number[]): number[] {
  let beta = ridgeFit(x, y, pen);
  for (let it = 0; it < 8; it++) {
    const w = y.map((yi, i) => {
      const r = yi - dot(x[i]!, beta);
      return 1 / Math.max(Math.abs(r), 0.2);
    });
    const sw = w.map((v) => Math.sqrt(v));
    const xw = x.map((row, i) => row.map((v) => v * sw[i]!));
    const yw = y.map((v, i) => v * sw[i]!);
    beta = ridgeFit(xw, yw, pen);
  }
  return beta;
}

/** Dot product of two equal-length vectors. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** A quantile by linear interpolation on sorted values (the usual definition). */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) throw new LedgerError('quantile: no values');
  if (n === 1) return sorted[0]!;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** The median absolute log error, as a multiple: exp(median |pred - actual|). */
export function typicalMiss(pred: number[], actual: number[]): number {
  const errs = pred.map((p, i) => Math.abs(p - actual[i]!)).sort((a, b) => a - b);
  return Math.exp(quantile(errs, 0.5));
}

/** The Brier score: the mean squared gap between a predicted probability and the 0/1 outcome. */
export function brierScore(pred: number[], actual: number[]): number {
  let s = 0;
  for (let i = 0; i < pred.length; i++) s += (pred[i]! - actual[i]!) * (pred[i]! - actual[i]!);
  return s / pred.length;
}

/** The logistic function, clipped so it never overflows. */
export function logistic(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

// ---------------------------------------------------------------- the value multiple

/** The traded tokens the value multiple is fitted on: live, with a market cap, a TVL, a listed date. */
export function valueFitSet(snap: Snap): Proto[] {
  return snap.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
}

/** One rung of the value ladder: which terms it adds, and its two held-out misses. */
export interface ValueRung {
  label: string;
  terms: string[];
  kept: boolean;
  loo: number;
  wfSingle: number;
  wfMulti: number;
}

/** The fitted value model: coefficients, the terms it kept, and the evidence for them. */
export interface ValueModel {
  n: number;
  lcMean: number;
  categories: string[];
  beta: number[];
  lambdaCat: number;
  looMiss: number;
  wfSingleMiss: number;
  wfMultiMiss: number;
  flatLoo: number;
  flatWfSingle: number;
  flatWfMulti: number;
  ladder: ValueRung[];
  looResiduals: number[];
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  looCover2575: number;
  looCover1090: number;
  looWithin3: number;
  wfCover2575: number;
  wfCover1090: number;
  wfWithin3: number;
  wfCover2575Big: number;
  wfCover1090Big: number;
  wfN: number;
  wfBigN: number;
}

const VALUE_LAMBDA_CAT = 30;

/** The value design rows for a set of protocols, in the model's term order. */
function valueRows(protocols: Proto[], lcMean: number, categories: string[], asOf: string): number[][] {
  const catAt = new Map(categories.map((c, i) => [c, i]));
  const n = categories.length;
  const rows = protocols.map((p) => {
    const lc = Math.log(p.tvl_usd) - lcMean;
    const row = new Array<number>(7 + n).fill(0);
    row[0] = 1;
    row[1] = lc;
    row[2] = lc * lc;
    row[3] = p.chains.length;
    const at = catAt.get(p.category ?? '?');
    if (at !== undefined) row[4 + at] = 1;
    // Tested-not-kept columns: 7-day growth (winsorised log) and age in years.
    // The snapshot's change_7d is already in per cent, so it is divided by 100 first.
    const g = Math.min(1.2, Math.max(-0.7, (p.change_7d ?? 0) / 100));
    row[4 + n] = Math.sign(g) * Math.log1p(Math.abs(g));
    row[5 + n] = (ageDays(asOf, p.listed_at) ?? 180) / 365;
    return row;
  });
  // The placebo control: another row's growth, shifted by seven. It must not help.
  for (let i = 0; i < rows.length; i++) rows[i]![6 + n] = rows[(i - 7 + rows.length) % rows.length]![4 + n]!;
  return rows;
}

/** The penalty per column for a value design: only the category effects are shrunk. */
function valuePen(nCat: number): number[] {
  return [0, 0, 0, 0, ...new Array<number>(nCat).fill(VALUE_LAMBDA_CAT), 0, 0, 0];
}

/** Which columns a rung uses: flat, size, quad, chains, cat, and the tested extras. */
function valueCols(terms: string[], nCat: number): number[] {
  const cols = [0];
  if (terms.includes('size')) cols.push(1);
  if (terms.includes('quad')) cols.push(2);
  if (terms.includes('chains')) cols.push(3);
  if (terms.includes('cat')) for (let i = 0; i < nCat; i++) cols.push(4 + i);
  if (terms.includes('growth')) cols.push(4 + nCat);
  if (terms.includes('age')) cols.push(5 + nCat);
  if (terms.includes('ctrl')) cols.push(6 + nCat);
  return cols;
}

/** A design restricted to the rung's columns, with the matching penalties. */
function valueSub(x: number[][], pen: number[], cols: number[]): { x: number[][]; pen: number[] } {
  return { x: x.map((row) => cols.map((c) => row[c]!)), pen: cols.map((c) => pen[c]!) };
}

/** Leave-one-out predictions for a rung, by the median fit. */
function valueLoo(x: number[][], y: number[], pen: number[], cols: number[]): number[] {
  const sub = valueSub(x, pen, cols);
  const out = new Array<number>(y.length).fill(0);
  for (let i = 0; i < y.length; i++) {
    const tr = x.map((_, j) => j).filter((j) => j !== i);
    const xt = tr.map((j) => sub.x[j]!);
    const yt = tr.map((j) => y[j]!);
    const beta = medianFit(xt, yt, sub.pen);
    out[i] = dot(sub.x[i]!, beta);
  }
  return out;
}

/** Walk-forward, one split: train on the earlier-listed half, test on the later half. */
function valueWfSingle(x: number[][], y: number[], pen: number[], cols: number[], listed: string[]): { pred: number[]; actual: number[] } {
  const sorted = [...listed].sort();
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const tr = listed.map((d, i) => (d < med ? i : -1)).filter((i) => i >= 0);
  const te = listed.map((d, i) => (d >= med ? i : -1)).filter((i) => i >= 0);
  const sub = valueSub(x, pen, cols);
  const beta = medianFit(tr.map((i) => sub.x[i]!), tr.map((i) => y[i]!), sub.pen);
  return { pred: te.map((i) => dot(sub.x[i]!, beta)), actual: te.map((i) => y[i]!) };
}

/** Walk-forward, four expanding windows by listed date: the pooled held-out miss. */
function valueWfMulti(x: number[][], y: number[], pen: number[], cols: number[], listed: string[]): { pred: number[]; actual: number[] } {
  const order = listed.map((d, i) => i).sort((a, b) => (listed[a]! < listed[b]! ? -1 : listed[a]! > listed[b]! ? 1 : a - b));
  const n = order.length;
  const cuts = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n];
  const sub = valueSub(x, pen, cols);
  const pred: number[] = [];
  const actual: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const tr = order.slice(0, cuts[k]!);
    const te = order.slice(cuts[k]!, cuts[k + 1]!);
    const beta = medianFit(tr.map((i) => sub.x[i]!), tr.map((i) => y[i]!), sub.pen);
    for (const i of te) {
      pred.push(dot(sub.x[i]!, beta));
      actual.push(y[i]!);
    }
  }
  return { pred, actual };
}

/** The flat prediction's held-out misses: the median of the others, and of the train half. */
function valueFlat(x: number[][], y: number[], listed: string[]): { loo: number; wfSingle: number; wfMulti: number } {
  const n = y.length;
  const looPred = y.map((_, i) => {
    const rest = y.filter((_, j) => j !== i).sort((a, b) => a - b);
    return quantile(rest, 0.5);
  });
  const wf1 = valueWfSplitFlat(y, listed);
  const order = listed.map((d, i) => i).sort((a, b) => (listed[a]! < listed[b]! ? -1 : listed[a]! > listed[b]! ? 1 : a - b));
  const cuts = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n];
  const pred: number[] = [];
  const actual: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const tr = order.slice(0, cuts[k]!);
    const te = order.slice(cuts[k]!, cuts[k + 1]!);
    const med = quantile(tr.map((i) => y[i]!).sort((a, b) => a - b), 0.5);
    for (const i of te) {
      pred.push(med);
      actual.push(y[i]!);
    }
  }
  return { loo: typicalMiss(looPred, y), wfSingle: wf1, wfMulti: typicalMiss(pred, actual) };
}

function valueWfSplitFlat(y: number[], listed: string[]): number {
  const sorted = [...listed].sort();
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const tr = y.filter((_, i) => listed[i]! < med).sort((a, b) => a - b);
  const te = y.filter((_, i) => listed[i]! >= med);
  const m = quantile(tr, 0.5);
  return typicalMiss(te.map(() => m), te);
}

/**
 * Fit the value model and prove every term. A term is kept only when adding it lowers the
 * held-out miss in BOTH the leave-one-out test and the walk-forward test; the ladder prints
 * the misses for every rung, including the ones that failed.
 */
export function fitValue(snap: Snap): ValueModel {
  const set = valueFitSet(snap);
  const n = set.length;
  const y = set.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const listed = set.map((p) => p.listed_at!);
  const lcMean = set.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / n;
  const categories = [...new Set(set.map((p) => p.category ?? '?'))].sort();
  const x = valueRows(set, lcMean, categories, snap.as_of);
  const pen = valuePen(categories.length);

  const rungs: ValueRung[] = [];
  const flat = valueFlat(x, y, listed);
  rungs.push({ label: 'flat median multiple', terms: [], kept: true, loo: flat.loo, wfSingle: flat.wfSingle, wfMulti: flat.wfMulti });
  const ladderTerms: string[][] = [['size'], ['size', 'quad'], ['size', 'quad', 'chains'], ['size', 'quad', 'chains', 'cat']];
  let prev = flat;
  for (const terms of ladderTerms) {
    const cols = valueCols(terms, categories.length);
    const loo = typicalMiss(valueLoo(x, y, pen, cols), y);
    const wf1 = valueWfSingle(x, y, pen, cols, listed);
    const wfM = valueWfMulti(x, y, pen, cols, listed);
    const kept = loo < prev.loo && typicalMiss(wf1.pred, wf1.actual) < prev.wfSingle && typicalMiss(wfM.pred, wfM.actual) < prev.wfMulti;
    rungs.push({
      label: `+ ${terms[terms.length - 1]!}`,
      terms: [...terms],
      kept,
      loo,
      wfSingle: typicalMiss(wf1.pred, wf1.actual),
      wfMulti: typicalMiss(wfM.pred, wfM.actual),
    });
    if (kept) prev = { loo, wfSingle: typicalMiss(wf1.pred, wf1.actual), wfMulti: typicalMiss(wfM.pred, wfM.actual) };
  }
  // Terms tested on the full model and not kept: each must fail at least one held-out test.
  const fullCols = valueCols(['size', 'quad', 'chains', 'cat'], categories.length);
  const extras: Array<{ label: string; terms: string[] }> = [
    { label: '+ 7-day growth', terms: ['size', 'quad', 'chains', 'cat', 'growth'] },
    { label: '+ age, years listed', terms: ['size', 'quad', 'chains', 'cat', 'age'] },
    { label: '+ control: growth of another row', terms: ['size', 'quad', 'chains', 'cat', 'ctrl'] },
  ];
  for (const extra of extras) {
    const cols = valueCols(extra.terms, categories.length);
    const loo = typicalMiss(valueLoo(x, y, pen, cols), y);
    const wf1 = valueWfSingle(x, y, pen, cols, listed);
    const wfM = valueWfMulti(x, y, pen, cols, listed);
    rungs.push({
      label: extra.label,
      terms: [...extra.terms],
      kept: false,
      loo,
      wfSingle: typicalMiss(wf1.pred, wf1.actual),
      wfMulti: typicalMiss(wfM.pred, wfM.actual),
    });
  }

  // The final fit, on all 95, in the kept columns only, and its leave-one-out residuals.
  const fullSub = valueSub(x, pen, fullCols);
  const beta = medianFit(fullSub.x, y, fullSub.pen);
  const looPred = valueLoo(x, y, pen, fullCols);
  const looResiduals = y.map((v, i) => v - looPred[i]!);
  const sortedRes = [...looResiduals].sort((a, b) => a - b);
  const q10 = quantile(sortedRes, 0.1);
  const q25 = quantile(sortedRes, 0.25);
  const q75 = quantile(sortedRes, 0.75);
  const q90 = quantile(sortedRes, 0.9);
  const looCover2575 = looResiduals.filter((r) => r >= q25 && r <= q75).length / n;
  const looCover1090 = looResiduals.filter((r) => r >= q10 && r <= q90).length / n;
  const looWithin3 = looResiduals.filter((r) => Math.abs(r) <= Math.log(3)).length / n;

  // Walk-forward calibration: intervals from the train half's own leave-one-out residuals.
  const sortedListed = [...listed].sort();
  const med = sortedListed[Math.floor(sortedListed.length / 2)]!;
  const trIdx = listed.map((d, i) => (d < med ? i : -1)).filter((i) => i >= 0);
  const teIdx = listed.map((d, i) => (d >= med ? i : -1)).filter((i) => i >= 0);
  const trainRes: number[] = [];
  for (const i of trIdx) {
    const rest = trIdx.filter((j) => j !== i);
    const betaTr = medianFit(rest.map((j) => fullSub.x[j]!), rest.map((j) => y[j]!), fullSub.pen);
    trainRes.push(y[i]! - dot(fullSub.x[i]!, betaTr));
  }
  const trainSorted = [...trainRes].sort((a, b) => a - b);
  const tq10 = quantile(trainSorted, 0.1);
  const tq25 = quantile(trainSorted, 0.25);
  const tq75 = quantile(trainSorted, 0.75);
  const tq90 = quantile(trainSorted, 0.9);
  const betaTr = medianFit(trIdx.map((i) => fullSub.x[i]!), trIdx.map((i) => y[i]!), fullSub.pen);
  const testRes = teIdx.map((i) => y[i]! - dot(fullSub.x[i]!, betaTr));
  const wfCover2575 = testRes.filter((r) => r >= tq25 && r <= tq75).length / testRes.length;
  const wfCover1090 = testRes.filter((r) => r >= tq10 && r <= tq90).length / testRes.length;
  const wfWithin3 = testRes.filter((r) => Math.abs(r) <= Math.log(3)).length / testRes.length;
  const bigIdx = teIdx.filter((i) => set[i]!.tvl_usd >= 50_000_000);
  const bigRes = bigIdx.map((i) => y[i]! - dot(fullSub.x[i]!, betaTr));
  const wfCover2575Big = bigRes.length > 0 ? bigRes.filter((r) => r >= tq25 && r <= tq75).length / bigRes.length : 0;
  const wfCover1090Big = bigRes.length > 0 ? bigRes.filter((r) => r >= tq10 && r <= tq90).length / bigRes.length : 0;

  const finalRung = rungs[4]!;
  return {
    n,
    lcMean,
    categories,
    beta,
    lambdaCat: VALUE_LAMBDA_CAT,
    looMiss: finalRung.loo,
    wfSingleMiss: finalRung.wfSingle,
    wfMultiMiss: finalRung.wfMulti,
    flatLoo: rungs[0]!.loo,
    flatWfSingle: rungs[0]!.wfSingle,
    flatWfMulti: rungs[0]!.wfMulti,
    ladder: rungs,
    looResiduals,
    q10,
    q25,
    q75,
    q90,
    looCover2575,
    looCover1090,
    looWithin3,
    wfCover2575,
    wfCover1090,
    wfWithin3,
    wfCover2575Big,
    wfCover1090Big,
    wfN: testRes.length,
    wfBigN: bigRes.length,
  };
}

/** The fitted multiple for one protocol: exp(intercept + size + quad + chains + category). */
export function fittedMultiple(p: Proto, model: ValueModel): number {
  const lc = Math.log(p.tvl_usd) - model.lcMean;
  let log = model.beta[0]! + model.beta[1]! * lc + model.beta[2]! * lc * lc + model.beta[3]! * p.chains.length;
  const at = model.categories.indexOf(p.category ?? '?');
  if (at >= 0) log += model.beta[4 + at]!;
  return Math.exp(log);
}

// ---------------------------------------------------------------- the token odds

/** The peers the odds are fitted on: listed a year or more, not an exchange, growth reported. */
export function oddsPeerSet(snap: Snap): Proto[] {
  return snap.protocols
    .filter((p) => {
      const a = ageDays(snap.as_of, p.listed_at);
      return a !== null && a >= 365 && p.category !== 'CEX' && p.change_7d !== null;
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** One rung of the odds ladder: which terms it adds, and its two held-out Briers. */
export interface OddsRung {
  label: string;
  terms: string[];
  kept: boolean;
  tenFold: number;
  wfSingle: number;
  wfMulti: number;
}

/** The fitted odds model: coefficients, the terms it kept, and the evidence for them. */
export interface OddsModel {
  n: number;
  baseRate: number;
  categories: string[];
  topChains: string[];
  beta: number[];
  lambdaCat: number;
  lambdaChain: number;
  tenFold: number;
  wfSingle: number;
  wfMulti: number;
  baseTenFold: number;
  baseWfSingle: number;
  baseWfMulti: number;
  ladder: OddsRung[];
}

const ODDS_LAMBDA_CAT = 3;
const ODDS_LAMBDA_CHAIN = 10;
const ODDS_TOP_CHAINS = 12;

/** The twelve most common first chains among the peers, ties by first appearance in slug order. */
function topChains(peers: Proto[]): string[] {
  const count = new Map<string, number>();
  const first = new Map<string, number>();
  peers.forEach((p, i) => {
    const ch = p.chains.length > 0 ? p.chains[0]! : '?';
    count.set(ch, (count.get(ch) ?? 0) + 1);
    if (!first.has(ch)) first.set(ch, i);
  });
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || first.get(a[0])! - first.get(b[0])!)
    .slice(0, ODDS_TOP_CHAINS)
    .map(([ch]) => ch);
}

/** The odds design rows, in the model's term order. */
function oddsRows(peers: Proto[], categories: string[], top: string[], asOf: string): number[][] {
  const catAt = new Map(categories.map((c, i) => [c, i]));
  const chAt = new Map(top.map((c, i) => [c, i]));
  const nCat = categories.length;
  const nCh = top.length + 1;
  return peers.map((p) => {
    const row = new Array<number>(2 + nCat + nCh).fill(0);
    row[0] = 1;
    const a = ageDays(asOf, p.listed_at);
    row[1] = Math.log1p((a ?? 180) / 365);
    const at = catAt.get(p.category ?? '?');
    if (at !== undefined) row[2 + at] = 1;
    const ch = p.chains.length > 0 ? p.chains[0]! : '?';
    const ct = chAt.get(ch);
    row[2 + nCat + (ct !== undefined ? ct : top.length)] = 1;
    return row;
  });
}

/** The penalty per column for an odds design: only the category and chain effects are shrunk. */
function oddsPen(nCat: number, nCh: number): number[] {
  return [0, 0, ...new Array<number>(nCat).fill(ODDS_LAMBDA_CAT), ...new Array<number>(nCh).fill(ODDS_LAMBDA_CHAIN)];
}

/** Which columns a rung uses: log-age, size, growth, cat, chain, and the placebo control. */
function oddsCols(terms: string[], nCat: number, nCh: number): number[] {
  const cols = [0, 1];
  if (terms.includes('size')) cols.push(2 + nCat + nCh);
  if (terms.includes('growth')) cols.push(3 + nCat + nCh);
  if (terms.includes('cat')) for (let i = 0; i < nCat; i++) cols.push(2 + i);
  if (terms.includes('chain')) for (let i = 0; i < nCh; i++) cols.push(2 + nCat + i);
  if (terms.includes('ctrl')) cols.push(4 + nCat + nCh);
  return cols;
}

/** The full odds design, with the tested-extra columns appended after the kept ones. */
function oddsFullRows(peers: Proto[], categories: string[], top: string[], asOf: string): number[][] {
  const base = oddsRows(peers, categories, top, asOf);
  const nCat = categories.length;
  const nCh = top.length + 1;
  const lcs = peers.map((p) => Math.log(p.tvl_usd));
  const lcMean = lcs.reduce((s, v) => s + v, 0) / lcs.length;
  const growth = peers.map((p) => {
    // change_7d is in per cent in the snapshot; the fraction is what the fit sees.
    const g = Math.min(1.2, Math.max(-0.7, (p.change_7d ?? 0) / 100));
    return Math.sign(g) * Math.log1p(Math.abs(g));
  });
  return base.map((row, i) => {
    const extra = [lcs[i]! - lcMean, growth[i]!, growth[(i - 7 + peers.length) % peers.length]!];
    return [...row, ...extra];
  });
}

function oddsFullPen(nCat: number, nCh: number): number[] {
  return [...oddsPen(nCat, nCh), 0, 0, 0];
}

/** The logistic fit by Newton steps: 60 rounds at most, stopping when the step is tiny. */
export function fitLogit(x: number[][], y: number[], pen: number[]): number[] {
  const m = x.length;
  const n = x[0]!.length;
  const mean = y.reduce((s, v) => s + v, 0) / m;
  const beta = new Array<number>(n).fill(0);
  beta[0] = Math.log(mean / (1 - mean));
  for (let it = 0; it < 60; it++) {
    const pr = x.map((row) => logistic(dot(row, beta)));
    const w = pr.map((p) => p * (1 - p) + 1e-9);
    const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let i = 0; i < m; i++) {
      const row = x[i]!;
      for (let j = 0; j < n; j++) {
        b[j] = b[j]! + row[j]! * (y[i]! - pr[i]!);
        for (let k = 0; k < n; k++) a[j]![k] = a[j]![k]! + row[j]! * row[k]! * w[i]!;
      }
    }
    for (let j = 0; j < n; j++) {
      a[j]![j] = a[j]![j]! + pen[j]!;
      b[j] = b[j]! - pen[j]! * beta[j]!;
    }
    const step = solveLinear(a, b);
    let biggest = 0;
    for (let j = 0; j < n; j++) {
      beta[j] = beta[j]! + step[j]!;
      biggest = Math.max(biggest, Math.abs(step[j]!));
    }
    if (biggest < 1e-10) break;
  }
  return beta;
}

/** Ten-fold Brier: folds by slug order, every tenth protocol held out in turn. */
function oddsTenFold(x: number[][], y: number[], pen: number[], cols: number[]): number {
  const sub = { x: x.map((row) => cols.map((c) => row[c]!)), pen: cols.map((c) => pen[c]!) };
  const pred = new Array<number>(y.length).fill(0);
  for (let f = 0; f < 10; f++) {
    const te = y.map((_, i) => i).filter((i) => i % 10 === f);
    const tr = y.map((_, i) => i).filter((i) => i % 10 !== f);
    const beta = fitLogit(tr.map((i) => sub.x[i]!), tr.map((i) => y[i]!), sub.pen);
    for (const i of te) pred[i] = logistic(dot(sub.x[i]!, beta));
  }
  return brierScore(pred, y);
}

/** Walk-forward, one split: train on the earlier-listed half, test on the later half. */
function oddsWfSingle(x: number[][], y: number[], pen: number[], cols: number[], listed: string[]): number {
  const sorted = [...listed].sort();
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const tr = listed.map((d, i) => (d < med ? i : -1)).filter((i) => i >= 0);
  const te = listed.map((d, i) => (d >= med ? i : -1)).filter((i) => i >= 0);
  const sub = { x: x.map((row) => cols.map((c) => row[c]!)), pen: cols.map((c) => pen[c]!) };
  const beta = fitLogit(tr.map((i) => sub.x[i]!), tr.map((i) => y[i]!), sub.pen);
  return brierScore(te.map((i) => logistic(dot(sub.x[i]!, beta))), te.map((i) => y[i]!));
}

/** Walk-forward, four expanding windows by listed date: the pooled held-out Brier. */
function oddsWfMulti(x: number[][], y: number[], pen: number[], cols: number[], listed: string[]): number {
  const order = listed.map((d, i) => i).sort((a, b) => (listed[a]! < listed[b]! ? -1 : listed[a]! > listed[b]! ? 1 : a - b));
  const n = order.length;
  const cuts = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n];
  const sub = { x: x.map((row) => cols.map((c) => row[c]!)), pen: cols.map((c) => pen[c]!) };
  const pred: number[] = [];
  const actual: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const tr = order.slice(0, cuts[k]!);
    const te = order.slice(cuts[k]!, cuts[k + 1]!);
    const beta = fitLogit(tr.map((i) => sub.x[i]!), tr.map((i) => y[i]!), sub.pen);
    for (const i of te) {
      pred.push(logistic(dot(sub.x[i]!, beta)));
      actual.push(y[i]!);
    }
  }
  return brierScore(pred, actual);
}

/** The base rate's Brier on the same splits: what the model must beat. */
function oddsBase(x: number[][], y: number[], listed: string[]): { tenFold: number; wfSingle: number; wfMulti: number } {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const tenFold = brierScore(y.map(() => mean), y);
  const sorted = [...listed].sort();
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const trMean = y.filter((_, i) => listed[i]! < med).reduce((s, v) => s + v, 0) / y.filter((_, i) => listed[i]! < med).length;
  const te = y.filter((_, i) => listed[i]! >= med);
  const wfSingle = brierScore(te.map(() => trMean), te);
  const order = listed.map((d, i) => i).sort((a, b) => (listed[a]! < listed[b]! ? -1 : listed[a]! > listed[b]! ? 1 : a - b));
  const n = order.length;
  const cuts = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n];
  const pred: number[] = [];
  const actual: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const tr = order.slice(0, cuts[k]!);
    const teIdx = order.slice(cuts[k]!, cuts[k + 1]!);
    const m = tr.reduce((s, i) => s + y[i]!, 0) / tr.length;
    for (const i of teIdx) {
      pred.push(m);
      actual.push(y[i]!);
    }
  }
  void x;
  return { tenFold, wfSingle, wfMulti: brierScore(pred, actual) };
}

/**
 * Fit the token odds and prove every term the same way as the value model:
 * a term is kept only when it lowers the Brier score in BOTH the ten-fold test
 * and the walk-forward test.
 */
export function fitOdds(snap: Snap): OddsModel {
  const peers = oddsPeerSet(snap);
  const n = peers.length;
  const y = peers.map((p) => (isPreToken(p) ? 0 : 1));
  const listed = peers.map((p) => p.listed_at!);
  const baseRate = y.reduce((s, v) => s + v, 0) / n;
  const categories = [...new Set(peers.map((p) => p.category ?? '?'))].sort();
  const top = topChains(peers);
  const x = oddsFullRows(peers, categories, top, snap.as_of);
  const pen = oddsFullPen(categories.length, top.length + 1);
  const base = oddsBase(x, y, listed);

  const rungs: OddsRung[] = [];
  rungs.push({ label: 'base rate of peers', terms: [], kept: true, tenFold: base.tenFold, wfSingle: base.wfSingle, wfMulti: base.wfMulti });
  const ladderTerms: string[][] = [['cat'], ['cat', 'chain']];
  let prev = base;
  for (const terms of ladderTerms) {
    const cols = oddsCols(terms, categories.length, top.length + 1);
    const tf = oddsTenFold(x, y, pen, cols);
    const wf1 = oddsWfSingle(x, y, pen, cols, listed);
    const wfM = oddsWfMulti(x, y, pen, cols, listed);
    const kept = tf < prev.tenFold && wfM < prev.wfMulti;
    rungs.push({ label: `+ ${terms[terms.length - 1]!}`, terms: [...terms], kept, tenFold: tf, wfSingle: wf1, wfMulti: wfM });
    if (kept) prev = { tenFold: tf, wfSingle: wf1, wfMulti: wfM };
  }
  const extras: Array<{ label: string; terms: string[] }> = [
    { label: '+ size, ln TVL', terms: ['cat', 'chain', 'size'] },
    { label: '+ 7-day growth', terms: ['cat', 'chain', 'growth'] },
    { label: '+ control: growth of another row', terms: ['cat', 'chain', 'ctrl'] },
  ];
  for (const extra of extras) {
    const cols = oddsCols(extra.terms, categories.length, top.length + 1);
    rungs.push({
      label: extra.label,
      terms: [...extra.terms],
      kept: false,
      tenFold: oddsTenFold(x, y, pen, cols),
      wfSingle: oddsWfSingle(x, y, pen, cols, listed),
      wfMulti: oddsWfMulti(x, y, pen, cols, listed),
    });
  }

  // The final fit, on all 442 peers, in the kept columns only.
  const finalCols = oddsCols(['cat', 'chain'], categories.length, top.length + 1);
  const sub = { x: x.map((row) => finalCols.map((c) => row[c]!)), pen: finalCols.map((c) => pen[c]!) };
  const beta = fitLogit(sub.x, y, sub.pen);
  const finalRung = rungs[2]!;
  return {
    n,
    baseRate,
    categories,
    topChains: top,
    beta,
    lambdaCat: ODDS_LAMBDA_CAT,
    lambdaChain: ODDS_LAMBDA_CHAIN,
    tenFold: finalRung.tenFold,
    wfSingle: finalRung.wfSingle,
    wfMulti: finalRung.wfMulti,
    baseTenFold: base.tenFold,
    baseWfSingle: base.wfSingle,
    baseWfMulti: base.wfMulti,
    ladder: rungs,
  };
}

/** The token odds for one protocol: the peers' record, as a probability. */
export function tokenOdds(p: Proto, model: OddsModel, asOf: string): number {
  const a = ageDays(asOf, p.listed_at);
  const years = (a ?? 180) / 365;
  let z = model.beta[0]! + model.beta[1]! * Math.log1p(years);
  const catAt = model.categories.indexOf(p.category ?? '?');
  if (catAt >= 0) z += model.beta[2 + catAt]!;
  const ch = p.chains.length > 0 ? p.chains[0]! : '?';
  const chAt = model.topChains.indexOf(ch);
  const nCat = model.categories.length;
  z += model.beta[2 + nCat + (chAt >= 0 ? chAt : model.topChains.length)]!;
  return logistic(z);
}

// ---------------------------------------------------------------- the board, the farm plan, the verdict

/** The farm scenario the board is scored under; the dashboard's controls move these. */
export interface FarmScenario {
  dropShare: number;
  poolFrac: number;
  horizonWeeks: number;
  tbillAnnual: number;
  hours: number;
}

export const FARM_DEFAULT: FarmScenario = { dropShare: 0.07, poolFrac: 0.01, horizonWeeks: 12, tbillAnnual: 0.05, hours: 3 };

/** Gas per transaction, by first chain: a stated estimate, never a fetched price. */
export const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 8,
  Solana: 0.1,
  Base: 0.5,
  Arbitrum: 0.5,
  Optimism: 0.5,
  Unichain: 0.5,
  Binance: 1,
  Polygon: 1,
};
export const GAS_DEFAULT = 2;

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on the protocol's first chain. */
export function gasFor(p: Proto): number {
  const ch = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_BY_CHAIN[ch] ?? GAS_DEFAULT;
}

function money(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

/** One farm step as a string: its action, then its cost and time. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The main action and its follow-up, by what the protocol does. */
function actionsFor(p: Proto, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const d = `$${capital}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply ${d} of USDC to ${name} on ${chain} as collateral and leave it earning.`,
      `Borrow $20 of USDC against the supply, then repay it the same week, so the position shows both sides of the market.`,
    ];
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return [
      `Add ${d} of liquidity to ${name}'s main pool on ${chain}, in the range the app suggests.`,
      `Claim the pool's fees once and add them back to the same position.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return [
      `Deposit ${d} of USDC as margin on ${name} and open one small hedge, no larger than a fifth of the deposit.`,
      `Close the hedge, then reopen it smaller, so the account shows two completed trades.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return [
      `Deposit ${d} into a ${name} vault on ${chain} and hold the vault shares.`,
      `Open the vault's allocation page, check which curator manages the largest share, and note the curator's fee.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint ${d} of ${name}'s yield asset on ${chain} and hold it in the farming wallet.`,
      `Read the asset's backing report and redemption window, and note the next redemption date.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund the account with ${d} and take one position in a market on ${name} that resolves after the hold window.`,
      `Leave the position open through one market resolution before touching it again.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake ${d} of the chain's staking asset through ${name} and keep the receipt token.`,
      `Check the operator set once and confirm the stake sits with an operator that has no slashing event.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit ${d} of the stable asset through ${name} on ${chain}.`,
      `Check the peg against a dollar and the redemption fee, and note both in the log.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy ${d} of cover from ${name} on ${chain} and keep the policy active.`,
      `Read the policy's exclusions once and confirm the covered event matches the position you hold.`,
    ];
  }
  return [
    `Deposit ${d} of USDC into ${name} on ${chain} and keep the position open.`,
    `Use the position once in the app's main function — a swap, a deposit, or a vote — and keep the receipt.`,
  ];
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, first chain,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: Proto, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const gas = money(gasFor(p));
  const [main, second] = actionsFor(p, capital, chain);
  const steps: Array<[string, string, string]> = [
    [`Start with a wallet used only for this farm, funded with exactly $${capital}, and store its seed phrase offline on paper.`, `about ${gas} of gas to fund it`, '5 minutes'],
    [main, `$${capital} of capital and about ${gas} of gas`, '15 minutes to set up'],
    [second, `about ${gas} of gas`, '20 minutes'],
    [`Do one qualifying action each week — a deposit, a borrow, a swap, or a vote — so the position stays active across snapshots.`, `about ${gas} of gas a week`, '10 minutes a week'],
    [`Leave the position untouched for at least ${hold} days, so the activity is counted in more than one snapshot.`, `the $${capital} stays in the position`, `${hold} days`],
    [`Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes — never pay anyone to claim.`, 'no fee to check', '10 minutes'],
    [`Write the wallet, the dates, and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.`, 'nothing but the log', '5 minutes'],
    [`Unwind in two stages: withdraw half, wait a day and check the points balance, then withdraw the rest.`, `about ${gas} of gas per withdrawal`, '2 days'],
    [`After the exit, revoke the protocol's token approvals and move the funds back to cold storage.`, `about ${gas} of gas`, '10 minutes'],
  ];
  return steps.map(([t, c, tm]) => stepText(t, c, tm));
}

/** A farm verdict: what the position is worth after fees, and what it pays per hour. */
export interface FarmVerdict {
  deposit: number;
  fees: number;
  gross: number;
  opportunity: number;
  net: number;
  netPerHour: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
}

/**
 * Score one farm position. The expected drop is the drop share of the implied value,
 * split across a farming pool assumed to be poolFrac of TVL; the farmer's share of
 * that pool is the deposit over the pool. Fees are six transactions at the chain's
 * gas plus 0.2% of the deposit; the opportunity cost is the deposit at the T-bill
 * rate over the horizon. FARM beats both the T-bill and $25 an hour; MARGINAL beats
 * the T-bill but not the hour; SKIP does not beat the T-bill.
 */
export function farmVerdict(implied: number, tvl: number, chain: string, sc: FarmScenario, depositOverride?: number): FarmVerdict {
  const deposit = depositOverride ?? capitalFor(tvl);
  const gas = GAS_BY_CHAIN[chain] ?? GAS_DEFAULT;
  const fees = 6 * gas + 0.002 * deposit;
  const gross = (sc.dropShare * implied * deposit) / (sc.poolFrac * tvl);
  const opportunity = (deposit * sc.tbillAnnual * sc.horizonWeeks) / 52;
  const net = gross - fees - opportunity;
  const netPerHour = net / sc.hours;
  const verdict = net > 0 && netPerHour >= 25 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return { deposit, fees, gross, opportunity, net, netPerHour, verdict };
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  parent_recorded: boolean;
  watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  if_launches_usd: number;
  token_odds: number;
  value_multiple: number;
  range_p25_usd: number;
  range_p75_usd: number;
  range_p10_usd: number;
  range_p90_usd: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  verdict_net_usd: number;
  verdict_net_per_hour_usd: number;
  farm_deposit_usd: number;
  farm_fees_usd: number;
  farm_gross_usd: number;
  live_comp_slug: string | null;
  live_comp_name: string | null;
  live_comp_category: string | null;
  live_comp_mcap_usd: number | null;
  live_comp_tvl_usd: number | null;
  farm_steps: string[];
}

/** A live-token protocol, for the dashboard's Live token view and the comparison. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One group of the ledger: every one of the 758 protocols sits in exactly one. */
export interface LedgerGroup {
  key: string;
  label: string;
  count: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The evidence the dashboard prints: fits, ladders, calibration, ledger, verdicts. */
export interface Evidence {
  modelVersion: string;
  asOf: string;
  floorUsd: number;
  snapshotProtocols: number;
  watchlist: number;
  value: ValueModel;
  odds: OddsModel;
  ledger: LedgerGroup[];
  verdicts: { farm: number; marginal: number; skip: number };
  farmDefaults: FarmScenario;
  gasByChain: Record<string, number>;
  gasDefault: number;
  boardTop: Array<{ rank: number; slug: string; name: string; implied: number }>;
}

/** The nearest live-token protocol by TVL, preferring the same category. */
function nearestLive(p: Proto, priced: Proto[]): Proto | null {
  if (priced.length === 0) return null;
  const same = priced.filter((q) => q.category === p.category);
  const pool = same.length > 0 ? same : priced;
  let best: Proto | null = null;
  let bestD = Infinity;
  for (const q of pool) {
    const d = Math.abs(Math.log(q.tvl_usd) - Math.log(p.tvl_usd));
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Build the board, the ledger and the evidence from the snapshot. */
export function buildLedger(snap: Snap): { board: BoardRow[]; data: RadarData; evidence: Evidence } {
  const value = fitValue(snap);
  const odds = fitOdds(snap);
  const parentSet = new Set(snap.protocols.filter((p) => isParentRecorded(p, snap)).map((p) => p.slug));
  const priced = snap.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  const ranked = snap.protocols.filter(isRankable);

  const scored = ranked.map((p) => {
    const age = ageDays(snap.as_of, p.listed_at);
    const multiple = fittedMultiple(p, value);
    const ifLaunches = p.tvl_usd * multiple;
    let od = tokenOdds(p, odds, snap.as_of);
    if (parentSet.has(p.slug)) od *= 0.5;
    const implied = Math.max(1, Math.round(ifLaunches * od));
    const chain = p.chains.length > 0 ? p.chains[0]! : '?';
    const verdict = farmVerdict(implied, p.tvl_usd, chain, FARM_DEFAULT);
    const comp = nearestLive(p, priced);
    return {
      p,
      age,
      multiple,
      ifLaunches,
      od,
      implied,
      verdict,
      comp,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    parent_recorded: parentSet.has(s.p.slug),
    watchlist: snap.watchlist.includes(s.p.slug),
    token_status: 'pre-token',
    implied_value_usd: s.implied,
    if_launches_usd: Math.max(1, Math.round(s.ifLaunches)),
    token_odds: s.od,
    value_multiple: s.multiple,
    range_p25_usd: Math.max(1, Math.round(s.ifLaunches * Math.exp(value.q25) * s.od)),
    range_p75_usd: Math.max(1, Math.round(s.ifLaunches * Math.exp(value.q75) * s.od)),
    range_p10_usd: Math.max(1, Math.round(s.ifLaunches * Math.exp(value.q10) * s.od)),
    range_p90_usd: Math.max(1, Math.round(s.ifLaunches * Math.exp(value.q90) * s.od)),
    verdict: s.verdict.verdict,
    verdict_net_usd: Math.round(s.verdict.net * 100) / 100,
    verdict_net_per_hour_usd: Math.round(s.verdict.netPerHour * 100) / 100,
    farm_deposit_usd: s.verdict.deposit,
    farm_fees_usd: Math.round(s.verdict.fees * 100) / 100,
    farm_gross_usd: Math.round(s.verdict.gross * 100) / 100,
    live_comp_slug: s.comp ? s.comp.slug : null,
    live_comp_name: s.comp ? s.comp.name : null,
    live_comp_category: s.comp ? s.comp.category : null,
    live_comp_mcap_usd: s.comp ? s.comp.mcap_usd : null,
    live_comp_tvl_usd: s.comp ? s.comp.tvl_usd : null,
    farm_steps: farmSteps(s.p, s.age),
  }));

  const live: LiveRow[] = snap.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  // The ledger: every protocol in exactly one group.
  const groups: LedgerGroup[] = [];
  const push = (key: string, label: string, count: number) => {
    if (count > 0) groups.push({ key, label, count });
  };
  const watchRanked = board.filter((r) => snap.watchlist.includes(r.slug)).length;
  const parentRanked = board.filter((r) => r.parent_recorded).length;
  const earlyRanked = board.length - watchRanked - parentRanked;
  push('ranked-watchlist', 'Ranked · watchlist', watchRanked);
  push('ranked-early', 'Ranked · early, below the floor', earlyRanked);
  push('ranked-parent', 'Ranked · off-list, parent recorded', parentRanked);
  const tokenPriced = snap.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0).length;
  const tokenUnpriced = snap.protocols.filter((p) => !isPreToken(p) && (p.mcap_usd === null || p.mcap_usd <= 0)).length;
  push('token-priced', 'Token trades · priced comp', tokenPriced);
  push('token-unpriced', 'Token recorded · no usable cap', tokenUnpriced);
  const out = snap.protocols.filter((p) => isPreToken(p) && !isRankable(p));
  const outByCat = new Map<string, number>();
  let outVersioned = 0;
  let outWrapped = 0;
  for (const p of out) {
    if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) {
      outByCat.set(p.category, (outByCat.get(p.category) ?? 0) + 1);
    } else if (VERSIONED.test(p.name)) {
      outVersioned++;
    } else {
      outWrapped++;
    }
  }
  for (const cat of [...outByCat.keys()].sort()) push(`out-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, `Out · ${cat.toLowerCase()}`, outByCat.get(cat)!);
  push('out-versioned', 'Out · versioned or wrapped', outVersioned + outWrapped);

  const verdicts = {
    farm: board.filter((r) => r.verdict === 'FARM').length,
    marginal: board.filter((r) => r.verdict === 'MARGINAL').length,
    skip: board.filter((r) => r.verdict === 'SKIP').length,
  };
  const data: RadarData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board,
    live,
  };
  const evidence: Evidence = {
    modelVersion: MODEL_VERSION,
    asOf: snap.as_of,
    floorUsd: snap.floor_usd,
    snapshotProtocols: snap.protocols.length,
    watchlist: snap.watchlist.length,
    value,
    odds,
    ledger: groups,
    verdicts,
    farmDefaults: FARM_DEFAULT,
    gasByChain: GAS_BY_CHAIN,
    gasDefault: GAS_DEFAULT,
    boardTop: board.slice(0, 10).map((r) => ({ rank: r.rank, slug: r.slug, name: r.name, implied: r.implied_value_usd })),
  };
  return { board, data, evidence };
}

// ---------------------------------------------------------------- checks and output

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LedgerError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new LedgerError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new LedgerError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new LedgerError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new LedgerError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new LedgerError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new LedgerError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new LedgerError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new LedgerError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps, value. */
export function boardIssue(board: BoardRow[], snap: Snap): string | null {
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!/^[^\s]{1,128}$/.test(r.slug)) return `${r.slug} is not a clean slug`;
  }
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(data: RadarData): string {
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

/** The evidence as a script the dashboard reads: the fits, the ladders, the ledger, the verdicts. */
export function evidenceScript(evidence: Evidence): string {
  return `window.EVIDENCE=${JSON.stringify(evidence)};\n`;
}
