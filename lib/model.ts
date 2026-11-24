// Token Radar model v3 (radar-3): implied value from TVL + 7d growth + age only.
// radar-3 adds the watchlist's launch-like exclusion to the board itself:
// Bridge / Liquid Staking / wrapped / staked products are set aside, not ranked.
// No protocol name is special-cased. No mcap, no APY, no airdrop probability.
//   base      = 250000 * (tvl_usd / 1e6) ^ 0.85
//   growthMult: g>=0: 1 + 0.60*ln(1+g/20)/ln(7)
//               -30<=g<0: 1 - 0.25*ln(1+|g|/20)/ln(2.5)
//               g<-30: max(0.30, 0.75 - 0.01*(|g|-30))
//   maturity  = 0.55 + 0.45*(1 - exp(-age/365)); age null -> 180d then x0.85, flagged unknown
//   implied   = max(1, round(base * growthMult * maturity))

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  base_scale: number; tvl_exponent: number; tvl_divisor: number;
  growth_pos_weight: number; growth_pos_scale: number; growth_pos_denom: number;
  growth_neg_weight: number; growth_neg_scale: number; growth_neg_denom: number;
  growth_steep_threshold: number; growth_steep_slope: number; growth_floor_mult: number;
  maturity_floor: number; maturity_range: number; maturity_scale_days: number;
  unknown_age_days: number; unknown_penalty: number;
}
export const MODEL: ModelConstants = {
  base_scale: 250000, tvl_exponent: 0.85, tvl_divisor: 1000000,
  growth_pos_weight: 0.6, growth_pos_scale: 20, growth_pos_denom: 1.9459101490553132,
  growth_neg_weight: 0.25, growth_neg_scale: 20, growth_neg_denom: 0.9162907318741551,
  growth_steep_threshold: -30, growth_steep_slope: 0.01, growth_floor_mult: 0.3,
  maturity_floor: 0.55, maturity_range: 0.45, maturity_scale_days: 365,
  unknown_age_days: 180, unknown_penalty: 0.85,
};
export const MODEL_VERSION = 'radar-3';
export const EARLY_ROWS = 158;
export const LIVE_ROWS = 24;

export interface FarmStep { text: string; cost: string; time: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null; age_unknown: boolean;
  implied_value_usd: number;
  model: { base_usd: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null; age_unknown: boolean; };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; age_days: number | null; age_unknown: boolean; watchlist: boolean;
  implied_value_usd: number; base_usd: number; growth_multiplier: number; maturity_multiplier: number;
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; live_size: number; excluded_size: number; rows: RadarRow[]; live: LiveRow[];
}
export class SnapshotError extends Error {
  constructor(m: string) { super(m); this.name = 'SnapshotError'; }
}
const DAY_MS = 86400000;
function finite(v: unknown, f: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : f;
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
export function growthMultiplier(g: number | null, m: ModelConstants = MODEL): number {
  const raw = g === null || g === undefined ? 0 : g;
  if (raw >= 0) return 1 + m.growth_pos_weight * Math.log1p(raw / m.growth_pos_scale) / m.growth_pos_denom;
  if (raw >= m.growth_steep_threshold) return 1 - m.growth_neg_weight * Math.log1p(Math.abs(raw) / m.growth_neg_scale) / m.growth_neg_denom;
  return Math.max(m.growth_floor_mult, 0.75 - m.growth_steep_slope * (Math.abs(raw) - 30));
}
export function maturityMultiplier(age: number | null, m: ModelConstants = MODEL): { mult: number; ageEff: number; unknown: boolean } {
  if (age === null) {
    const base = m.maturity_floor + m.maturity_range * (1 - Math.exp(-m.unknown_age_days / m.maturity_scale_days));
    return { mult: base * m.unknown_penalty, ageEff: m.unknown_age_days, unknown: true };
  }
  return { mult: m.maturity_floor + m.maturity_range * (1 - Math.exp(-age / m.maturity_scale_days)), ageEff: age, unknown: false };
}
export function baseValue(tvl: number, m: ModelConstants = MODEL): number {
  return m.base_scale * Math.pow(tvl / m.tvl_divisor, m.tvl_exponent);
}
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; ageUnknown: boolean } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthMult = growthMultiplier(p.change_7d, model);
  const mat = maturityMultiplier(age, model);
  const base = baseValue(p.tvl_usd, model);
  const implied = Math.max(1, Math.round(base * growthMult * mat.mult));
  return { implied, base, growthPct: rawGrowth, growthMult, maturityMult: mat.mult, age, ageUnknown: mat.unknown };
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
// Launch-like rule (radar-3): same exclusions as the watchlist rule.
// Wrapped / staked / bridged products are not new launches: they are a
// wrapped, staked or bridged form of a token that already trades.
// Categories, whole-word names and exchange prefixes are all checked.
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
export const EXCHANGE_PREFIXES = [
  'Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini',
];
export const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
export function isExcludedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return true;
  return false;
}
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcludedProduct(p) && !VERSIONED.test(p.name);
}
function bySlug(ps: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(ps.map((p) => [p.slug, p]));
}
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // All rankable pre-token, not just top-160 below the floor: 40 watchlist + 249 others = 289.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, age_unknown: s.ageUnknown,
    implied_value_usd: s.implied,
    model: {
      base_usd: Math.round(s.base), growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult), maturity_multiplier: round4(s.maturityMult),
      age_days: s.age, age_unknown: s.ageUnknown,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5000000000) return 250;
  if (p.tvl_usd >= 1000000000) return 150;
  if (p.tvl_usd >= 100000000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'about $8';
  if (c.includes('solana')) return 'under $0.10';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('unichain') || c.includes('ink') || c.includes('katana') || c.includes('tempo') || c.includes('arc') || c.includes('corn') || c.includes('monad')) return 'under $1';
  if (c.includes('binance') || c.includes('polygon') || c.includes('avalanche') || c.includes('bitcoin') || c.includes('hyperliquid')) return 'about $1';
  return 'about $2';
}
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Borrow $20 of USDC against the supplied collateral on ${name}, then repay it within a week while keeping the health factor above 2.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Claim the trading fees once from ${name}, then add the claimed fees back into the same pool on ${chain}.`;
  if (c.includes('bridge')) return `Use the bridged funds for one swap or deposit on the destination chain, then keep a small balance there for the next week.`;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak') || c.includes('staking')) return `Check the operator or validator set for ${name} and confirm the stake receipt shows the correct amount and chain.`;
  if (c.includes('rwa')) return `Check the redemption window and the backing report for ${name} before the hold ends, and confirm the asset can be redeemed on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Review the vault's current allocation and curator fee for ${name}, and confirm the vault caps allow a second deposit.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name}, record the result, then reopen a smaller position only if the market is open.`;
  if (c.includes('prediction')) return `Settle or close the market position on ${name} and record the outcome before opening another one.`;
  if (c.includes('insurance')) return `Confirm the cover expiry date and the claim window for ${name} in its policy page on ${chain}.`;
  if (c.includes('yield')) return `Harvest or compound the yield once on ${name} and record the amount harvested in the farm log.`;
  if (c.includes('stable')) return `Check the peg and the redemption fee for ${name} before minting any more of the stable asset.`;
  return `Make a second small deposit in ${name} on ${chain} and confirm it appears in the activity history.`;
}
function riskCheckFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Check the health factor and the borrow rate once a week; top up collateral if the health factor falls below 2.`;
  if (c.includes('dex')) return `Check the pool range, fees earned and price move once a week; adjust the range only if fees stop accruing.`;
  if (c.includes('bridge')) return `Check the bridge status and the destination balance once a week; do not bridge again while a transfer is pending.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the operator uptime and the unbonding period once a week; note any slashing or downtime warning.`;
  if (c.includes('rwa') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Check the vault allocation, curator fee and any redemption queue once a week; note changes before adding funds.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Check margin, funding and liquidation price once a week; reduce the position if margin falls below your limit.`;
  return `Check the position health, fees and the protocol's own announcements once a week on ${chain}; note any change before adding funds.`;
}
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: `${gas} of gas for the first transaction`, time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and ${gas} of gas`, time: '15 minutes to set up' },
    { text: secondActionFor(p, capital, chain), cost: `${gas} of gas and $20 of capital in the second action`, time: '10 minutes' },
    { text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: `${gas} of gas a week`, time: '10 minutes a week' },
    { text: `Open the protocol's own points or rewards page from its official site and check eligibility; claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: riskCheckFor(p, chain), cost: `${gas} of gas if you adjust the position`, time: '10 minutes a week' },
    { text: `Unwind in two parts: withdraw half, confirm it arrives in the fresh wallet, then withdraw the rest and close the position.`, cost: `${gas} of gas to unwind`, time: '20 minutes' },
    { text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it later.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
export function radarRow(row: BoardRow, isWatchlist = false): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd,
    listed_at: row.listed_at, age_days: row.age_days, age_unknown: row.age_unknown, watchlist: isWatchlist,
    implied_value_usd: row.implied_value_usd, base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // Pre-token protocols the starter rule would have ranked, but radar-3 sets
  // aside as wrapped / staked / bridged products (not new launches).
  const excluded = snapshot.protocols.filter((p) => isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !isRankable(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length, excluded_size: excluded,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))), live,
  };
  return { board, radar };
}
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share the same implied value`;
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
      if (!/Cost:/i.test(s) || !/Time:/i.test(s)) return `${r.slug} has a farm step without Cost + Time`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
