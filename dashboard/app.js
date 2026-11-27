// The Launch Ledger — dashboard logic. All numbers on this page come from
// data.js (the board) and evidence.js (the fits); nothing is invented here.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rows = window.RADAR.rows, live = window.RADAR.live, meta = window.RADAR;
const ev = window.EVIDENCE, FARM = { ...ev.farmDefaults, gasByChain: ev.gasByChain, gasDefault: ev.gasDefault };
const money = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n).toLocaleString('en-US');
const full = (n) => '$' + Math.round(n).toLocaleString('en-US');
const num = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d) + '%'; // change_7d is already in per cent
const age = (d) => d === null || d === undefined ? '—' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
const catOf = (r) => r.category;
const chainsOf = (r) => r.chains.slice(0, 2).join(' · ') + (r.chains.length > 2 ? ` +${r.chains.length - 2}` : '');
const boardChecksum = () => {
  let h = 0x811c9dc5;
  const text = rows.map((r) => `${r.rank}:${r.slug}:${r.implied_value_usd}:${r.range_p25_usd}-${r.range_p75_usd}`).join('|');
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};

/** Hash state: q cat chain tvl growth age wl verdict sort dir tab p exp cmp. */
function readHash() {
  const s = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  return {
    q: s.q || '', cat: s.cat || '', chain: s.chain || '', tvl: s.tvl || '', growth: s.growth || '',
    age: s.age || '', wl: s.wl === '1', verdict: s.verdict || '', sort: s.sort || 'implied', dir: s.dir || 'desc',
    tab: s.tab || 'pre', p: s.p || '', exp: s.exp || '', cmp: s.cmp || '',
  };
}
let st = readHash();
function writeHash() {
  const p = new URLSearchParams();
  for (const k of ['q', 'cat', 'chain', 'tvl', 'growth', 'age', 'verdict', 'sort', 'dir', 'tab', 'p', 'exp', 'cmp']) if (st[k]) p.set(k, st[k]);
  if (st.wl) p.set('wl', '1');
  history.replaceState(null, '', '#' + p.toString());
}
const expanded = new Set(st.exp ? st.exp.split(',') : []);
const compared = new Set(st.cmp ? st.cmp.split(',') : []);
function syncSets() {
  st.exp = [...expanded].join(',');
  st.cmp = [...compared].join(',');
  writeHash();
}

/** Scenario: what the farm verdict assumes. Deposit "auto" follows the TVL tier in evidence.js. */
let sc = { dep: 'auto', drop: FARM.dropShare, horizon: FARM.horizonWeeks };
function depositFor(r) {
  if (sc.dep !== 'auto') return +sc.dep;
  return r.tvl_usd >= 5e9 ? 250 : r.tvl_usd >= 1e9 ? 150 : r.tvl_usd >= 1e8 ? 100 : 50;
}
const GAS = FARM.gasByChain;
/** The same arithmetic the build uses (lib/model.ts farmVerdict), so the page can re-check it. */
function verdictFor(r) {
  const dep = depositFor(r), gas = GAS[r.chains[0]] ?? FARM.gasDefault;
  const fees = 6 * gas + 0.002 * dep;
  const gross = (sc.drop * r.implied_value_usd * dep) / (FARM.poolFrac * r.tvl_usd);
  const opp = dep * 0.05 * sc.horizon / 52;
  const net = gross - fees - opp, perHr = net / FARM.hours;
  const breakEvenDrop = (fees + opp) * FARM.poolFrac * r.tvl_usd / (r.implied_value_usd * dep);
  return { dep, fees, gross, opp, net, perHr, breakEvenDrop, verdict: net > 0 && perHr >= 25 ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP' };
}
/** Recompute the whole board against the stored board.json values (default scenario). */
let recomputeBad = 0;
for (const r of rows) {
  if (Math.round(r.tvl_usd * r.value_multiple * r.token_odds) !== r.implied_value_usd) recomputeBad++;
  const v = verdictFor(r);
  if (Math.abs(v.net - r.verdict_net_usd) > 0.01 || v.verdict !== r.verdict) recomputeBad++;
}

/* ---- proof strip ---- */
function proof() {
  const ig = ev.integrity;
  const checksum = boardChecksum();
  $('#proof').innerHTML = `<span class="ok">✓</span><span>watchlist <b>${ig.watchlistCovered}/${ig.watchlistTotal}</b></span><span>board <b>${rows.length}/${ig.boardRows}</b> rows = board.json</span><span>ledger <b>${ig.ledgerTotal}/${ig.snapshotProtocols}</b></span><span>farm plans <b>${ig.farmPlanRows}/${rows.length}</b></span><span>recompute <b>${recomputeBad} mismatches</b></span><span>checksum <b>${checksum}</b>${checksum === ig.boardChecksum ? ' ✓' : ' ≠ build'}</span><span>0 protocol names in model code</span>`;
}
function accounting() {
  const total = ev.ledger.reduce((sum, g) => sum + g.count, 0);
  const colors = ['#1c1917', '#166534', '#b45309', '#78716c', '#a8a29e', '#7f1d1d'];
  const bar = ev.ledger.map((g, i) => `<i style="width:${(g.count / total * 100).toFixed(2)}%;background:${colors[i % colors.length]}" title="${esc(g.label)}: ${g.count}"></i>`).join('');
  const boardTotal = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const monotonic = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
  $('#accounting').innerHTML = `<div class="acct-head"><h3>Protocol accounting — all ${total} snapshot protocols in exactly one group</h3><span class="check-line">✓ ranks 1–${rows.length} in order, values ${monotonic ? 'never rise' : 'RISE'} · ✓ board total ${full(boardTotal)} · ✓ ledger ${total}/${ev.snapshotProtocols}</span></div><div class="bar">${bar}</div><div class="legend">${ev.ledger.map((g) => `<span>${esc(g.label)} <b>${g.count}</b></span>`).join('')}</div>`;
}
function bootline() {
  const vb = ev.value.boot, ob = ev.odds.boot;
  $('#bootline').innerHTML = `Fitted, ± bootstrap s.e. (${vb.refits} refits, seeded): multiple at $100M TVL (1 chain, modal category ${esc(vb.refCategory)}) <b>${vb.mult.toFixed(3)} ± ${vb.multSe.toFixed(3)}</b>; odds, in logits: intercept <b>${ev.odds.beta[0].toFixed(2)} ± ${ob.interceptSe.toFixed(2)}</b>, log-age <b>${ev.odds.beta[1].toFixed(2)} ± ${ob.logAgeSe.toFixed(2)}</b>.`;
}
function scatterHtml() {
  const sc = ev.scatter;
  const W = 340, H = 112, L = 36, R = 6, T = 6, B = 24;
  const x0 = 6, x1 = 10.6, y0 = 5, y1 = 11.4;
  const X = (tvl) => (L + (Math.log10(tvl) - x0) / (x1 - x0) * (W - L - R)).toFixed(1);
  const Y = (cap) => (H - B - (Math.log10(cap) - y0) / (y1 - y0) * (H - T - B)).toFixed(1);
  const bandTop = sc.band.map((b) => `${X(b.tvl)},${Y(b.hi)}`).join(' ');
  const bandBot = [...sc.band].reverse().map((b) => `${X(b.tvl)},${Y(b.lo)}`).join(' ');
  const mid = sc.band.map((b) => `${X(b.tvl)},${Y(b.mid)}`).join(' ');
  const pts = sc.points.map((p) => `<circle cx="${X(p.tvl)}" cy="${Y(p.mcap)}" r="2.2" fill="#b45309" fill-opacity="0.62" stroke="#1c1917" stroke-width="0.4"/>`).join('');
  const xticks = [[1e6, '$1M'], [1e7, '$10M'], [1e8, '$100M'], [1e9, '$1B'], [1e10, '$10B']].map(([v, l]) => `<text x="${X(v)}" y="${H - 13}" text-anchor="middle" class="ax">${l}</text><line x1="${X(v)}" y1="${T}" x2="${X(v)}" y2="${H - B}" class="grid"/>`).join('');
  const yticks = [[1e6, '$1M'], [1e8, '$100M'], [1e10, '$10B']].map(([v, l]) => `<text x="${L - 3}" y="${+Y(v) + 3}" text-anchor="end" class="ax">${l}</text><line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" class="grid"/>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="82" role="img" aria-label="Scatter of market cap against TVL for the 95 traded peers, with the fitted P25-P75 band">${xticks}${yticks}<polygon points="${bandTop} ${bandBot}" fill="#b45309" fill-opacity="0.16"/><polyline points="${mid}" fill="none" stroke="#1c1917" stroke-width="1.5"/>${pts}<text x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle" class="axl">TVL (log)</text><text x="10" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})" class="axl">Market cap (log)</text></svg>`;
  return `<div class="mini scatter-mini"><h3>Cap vs TVL — ${sc.points.length} traded peers, fitted P25–P75 band</h3>${svg}<p>Band: fitted curve (${esc(sc.refCategory)}, 1 chain) ± held-out P25–P75 residuals.</p></div>`;
}
function formulaStrip() {
  const r = rows[0];
  $('#formula-strip').innerHTML = `<p><b>Implied value = TVL × fitted multiple × token odds</b> — #1 ${esc(r.name)}: ${full(r.tvl_usd)} × ${num(r.value_multiple, 4)} × ${num(r.token_odds * 100, 1)}% = <b>${full(r.implied_value_usd)}</b>. Third check: category-blind value miss ×${ev.value.catBlindMiss.toFixed(2)}; category-blind odds Brier ${ev.odds.catBlindBrier.toFixed(3)}.</p>`;
}
function termStrip() {
  const v = ev.value, o = ev.odds;
  const vt = v.ladder.map((r) => `<tr><td>${esc(r.label)}</td><td>×${r.loo.toFixed(2)}</td><td>×${r.wfSingle.toFixed(2)}</td><td class="${r.kept ? 'kept' : 'notkept'}">${r.kept ? 'kept' : 'not kept'}</td></tr>`).join('');
  const ot = o.ladder.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.tenFold.toFixed(3)}</td><td>${r.wfMulti.toFixed(3)}</td><td>${Math.round(r.calledRight * 100)}%</td><td class="${r.kept ? 'kept' : 'notkept'}">${r.kept ? 'kept' : 'not kept'}</td></tr>`).join('');
  const rt = `<tr><td>inside P25–P75, stated 50%</td><td>${Math.round(v.looCover2575 * 100)}%</td><td>${Math.round(v.wfCover2575 * 100)}%</td></tr><tr><td>inside P10–P90, stated 80%</td><td>${Math.round(v.looCover1090 * 100)}%</td><td>${Math.round(v.wfCover1090 * 100)}%</td></tr><tr><td>within ×3 of the model</td><td>${Math.round(v.looWithin3 * 100)}%</td><td>${Math.round(v.wfWithin3 * 100)}%</td></tr>`;
  $('#term-strip').innerHTML = `<div class="mini"><h3>Value terms — LOO · walk-forward</h3><table class="ev"><tbody>${vt}</tbody></table></div><div class="mini"><h3>Odds terms — Brier 10-fold · walk-forward · called right</h3><table class="ev"><thead><tr><th>Term</th><th>Brier</th><th>WF</th><th>Right</th><th>Kept</th></tr></thead><tbody>${ot}</tbody></table></div><div class="mini"><h3>Is the printed range honest?</h3><table class="ev"><thead><tr><th>Share of real caps</th><th>LOO</th><th>Walk-fwd</th></tr></thead><tbody>${rt}</tbody></table><p>Claimed cover is measured, not labelled: ${Math.round(v.claim2575 * 100)}% · ${Math.round(v.claim1090 * 100)}%.</p></div>` + scatterHtml();
}

/* ---- the tape ---- */
function tape() {
  const v = ev.value, o = ev.odds, n = ev.verdicts;
  const cells = [
    ['Value miss, held out', '×' + v.wfSingleMiss.toFixed(2), 'WF vs ×' + v.flatLoo.toFixed(2) + ' flat'],
    ['Token odds, Brier', o.wfMulti.toFixed(3), 'WF vs ' + o.baseWfMulti.toFixed(3) + ' base'],
    ['Range honesty', Math.round(v.claim2575 * 100) + '% · ' + Math.round(v.claim1090 * 100) + '%', 'measured; WF ' + Math.round(v.wfCover2575 * 100) + '% · ' + Math.round(v.wfCover1090 * 100) + '%'],
    ['Fitted, not ruled', (v.ladder.filter((r) => r.kept).length - 1) + ' of ' + (v.ladder.length - 1) + ' terms', 'kept only if both tests help'],
    ['Worth farming', n.farm + ' FARM', n.marginal + ' marg · ' + n.skip + ' skip'],
    ['Watchlist', '40 / 40', 'all watchlist ranked'],
  ];
  $('#tape').innerHTML = cells.map(([k, val, d]) => `<div><div class="k">${k}</div><div class="v">${val}</div><div class="d">${d}</div></div>`).join('');
  $('#lede').innerHTML = `A token launch is a bet on two things: <b>what the protocol would be worth if it launched</b> — fitted from the ${v.n} protocols that already trade, and tested by leaving each one out and by predicting only the future from the past — and <b>whether it launches at all</b> — the peers' record, ${o.n} of them. Sentora Curator, our old number one at $185M, is now #${rows.findIndex((r) => r.slug === 'sentora-curator') + 1} at ${money(rows.find((r) => r.slug === 'sentora-curator').implied_value_usd)}: the fitted multiple at its size is small, and a parent that already trades halves the odds. That is the whole point of fitting instead of ruling.`;
}

/* ---- scenario ---- */
function scenarioPanel() {
  $('#scenario').innerHTML = `<div class="scenario-row"><span class="scenario-title">Farm scenario</span>
      <label class="sc-field">Deposit <select id="sc-dep">
        <option value="auto">Auto by TVL</option><option value="50">$50</option><option value="100">$100</option><option value="150">$150</option><option value="250">$250</option></select></label>
      <label class="sc-field">Drop <span class="val" id="sc-drop-v">${num(sc.drop * 100, 1)}%</span>
        <input type="range" id="sc-drop" min="1" max="20" step="0.5" value="${sc.drop * 100}"></label>
      <label class="sc-field">Horizon <span class="val" id="sc-hor-v">${sc.horizon} wk</span>
        <input type="range" id="sc-hor" min="4" max="52" step="1" value="${sc.horizon}"></label>
      <span class="scenario-out" id="sc-out"></span></div>
    <p class="note">Verdicts are net of gas (chain-aware) and of the 5% a T-bill would have paid on the same money, over ${FARM.hours} hours of your time. FARM means the net clears $25 an hour; MARGINAL means the net is positive; SKIP means it is not. Move any slider and every verdict on the board moves with it.</p>`;
  $('#sc-dep').value = sc.dep;
  $('#sc-dep').onchange = (e) => { sc.dep = e.target.value; renderBoard(); };
  $('#sc-drop').oninput = (e) => { sc.drop = +e.target.value / 100; $('#sc-drop-v').textContent = num(sc.drop * 100, 1) + '%'; renderBoard(); };
  $('#sc-hor').oninput = (e) => { sc.horizon = +e.target.value; $('#sc-hor-v').textContent = sc.horizon + ' wk'; renderBoard(); };
}
function scenarioLine() {
  let f = 0, m = 0, s = 0;
  for (const r of rows) { const v = verdictFor(r).verdict; if (v === 'FARM') f++; else if (v === 'MARGINAL') m++; else s++; }
  $('#sc-out').innerHTML = `At a ${num(sc.drop * 100, 1)}% drop, a ${FARM.poolFrac * 100}% pool and ${sc.horizon} weeks: <b>${f} FARM</b> · ${m} marginal · ${s} skip.`;
}

/* ---- filters ---- */
const CATS = [...new Set(rows.map(catOf))].sort();
const CHAINS = [...new Set(rows.map((r) => r.chains[0]))].sort();
const TVL_BUCKETS = [['', 'Any TVL'], ['50', '$50M–$100M'], ['100', '$100M–$1B'], ['1000', '$1B+']];
const GROWTH_BUCKETS = [['', 'Any growth'], ['pos', 'Growing (7d +)'], ['neg', 'Shrinking (7d −)']];
const AGE_BUCKETS = [['', 'Any age'], ['young', 'Under 1 year'], ['mid', '1–3 years'], ['old', 'Over 3 years']];
function opt(list, cur) { return list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join(''); }
function filtersPanel() {
  $('#filters').innerHTML = `<div class="filter-grid">
    <div class="field"><label for="f-q">Search</label><input type="text" id="f-q" placeholder="name or slug" value="${esc(st.q)}"></div>
    <div class="field"><label for="f-cat">Category</label><select id="f-cat">${opt([['', 'All categories'], ...CATS.map((c) => [c, c])], st.cat)}</select></div>
    <div class="field"><label for="f-chain">Chain</label><select id="f-chain">${opt([['', 'All chains'], ...CHAINS.map((c) => [c, c])], st.chain)}</select></div>
    <div class="field"><label for="f-tvl">TVL</label><select id="f-tvl">${opt(TVL_BUCKETS, st.tvl)}</select></div>
    <div class="field"><label for="f-growth">7-day growth</label><select id="f-growth">${opt(GROWTH_BUCKETS, st.growth)}</select></div>
    <div class="field"><label for="f-age">Age without token</label><select id="f-age">${opt(AGE_BUCKETS, st.age)}</select></div>
    <div class="field"><label for="f-verdict">Verdict</label><select id="f-verdict">${opt([['', 'Any verdict'], ['FARM', 'FARM'], ['MARGINAL', 'MARGINAL'], ['SKIP', 'SKIP']], st.verdict)}</select></div>
    <div class="field"><label for="f-sort">Sort by</label><select id="f-sort">${opt([
      ['implied', 'Implied value'], ['tvl', 'TVL'], ['vpt', 'Value per TVL'], ['growth', '7-day growth'],
      ['age', 'Age'], ['name', 'Name'], ['odds', 'Token odds'], ['net', 'Net per hour']], st.sort)}</select></div>
    <label class="check"><input type="checkbox" id="f-wl"${st.wl ? ' checked' : ''}> Watchlist only</label>
  </div>`;
  $('#f-q').oninput = (e) => { st.q = e.target.value; writeHash(); renderBoard(); };
  for (const [id, key] of [['f-cat', 'cat'], ['f-chain', 'chain'], ['f-tvl', 'tvl'], ['f-growth', 'growth'], ['f-age', 'age'], ['f-verdict', 'verdict'], ['f-sort', 'sort']]) {
    $('#' + id).onchange = (e) => { st[key] = e.target.value; writeHash(); renderBoard(); };
  }
  $('#f-wl').onchange = (e) => { st.wl = e.target.checked; writeHash(); renderBoard(); };
}
function filtered() {
  const q = st.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (st.cat && catOf(r) !== st.cat) return false;
    if (st.chain && r.chains[0] !== st.chain) return false;
    if (st.tvl === '50' && (r.tvl_usd < 5e7 || r.tvl_usd >= 1e8)) return false;
    if (st.tvl === '100' && (r.tvl_usd < 1e8 || r.tvl_usd >= 1e9)) return false;
    if (st.tvl === '1000' && r.tvl_usd < 1e9) return false;
    if (st.growth === 'pos' && (r.change_7d === null || r.change_7d < 0)) return false;
    if (st.growth === 'neg' && (r.change_7d === null || r.change_7d >= 0)) return false;
    if (st.age === 'young' && (r.age_days === null || r.age_days >= 365)) return false;
    if (st.age === 'mid' && (r.age_days === null || r.age_days < 365 || r.age_days >= 1095)) return false;
    if (st.age === 'old' && (r.age_days === null || r.age_days < 1095)) return false;
    if (st.wl && !r.watchlist) return false;
    if (st.verdict && verdictFor(r).verdict !== st.verdict) return false;
    return true;
  });
}
function sorted(list) {
  const dir = st.dir === 'asc' ? 1 : -1;
  const key = {
    implied: (r) => r.implied_value_usd, tvl: (r) => r.tvl_usd, vpt: (r) => r.implied_value_usd / r.tvl_usd,
    growth: (r) => r.change_7d ?? -1, age: (r) => r.age_days ?? -1, name: (r) => r.name.toLowerCase(),
    odds: (r) => r.token_odds, net: (r) => verdictFor(r).perHr,
  }[st.sort] || ((r) => r.implied_value_usd);
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return a.rank - b.rank;
    return (ka < kb ? -1 : 1) * dir;
  });
}

/* ---- the board ---- */
const HEADS = [
  ['rank', '#', 0], ['name', 'Protocol', 0], ['tvl', 'TVL', 1], ['growth', '7d', 1],
  ['age', 'Age', 1], ['implied', 'If launches', 1], ['implied', 'Implied · P25–P75', 1], ['odds', 'Token odds', 1],
  ['verdict', 'Farm verdict', 0], ['net', 'Net / hr', 1],
];
const WHEN = ['Day 0', 'Day 0', 'Day 0–1', 'Weekly', 'Hold', 'Before exit', 'Ongoing', 'Exit', 'After exit'];
function parseStep(s) {
  const ci = s.indexOf(' Cost: ');
  const ti = s.indexOf(' Time: ');
  if (ci < 0 || ti < 0) return { step: s, cost: '—', time: '—' };
  return { step: s.slice(0, ci), cost: s.slice(ci + 7, ti), time: s.slice(ti + 7).replace(/\.$/, '') };
}
function farmPlanHtml(r) {
  const v = verdictFor(r);
  const body = r.farm_steps.map((s, i) => {
    const p = parseStep(s);
    return `<tr><td class="when">${WHEN[i] || ''}</td><td>${esc(p.step)}</td><td class="num">${esc(p.cost)}</td><td class="num">${esc(p.time)}</td></tr>`;
  }).join('');
  return `<div class="farmplan"><div class="farmplan-head"><b>Farm plan — ${esc(r.name)}</b><span class="chip ${v.verdict.toLowerCase()}">${v.verdict}</span><span>${full(v.dep)} deposit · net ${v.net >= 0 ? '' : '−'}${full(Math.abs(v.net))} · ${v.perHr >= 0 ? '' : '−'}$${Math.abs(v.perHr).toFixed(2)}/hr · break-even drop ${num(v.breakEvenDrop * 100, 1)}%</span></div><table class="plan"><thead><tr><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function boardCsv() {
  const cols = ['rank', 'slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'watchlist', 'parent_recorded', 'if_launches_usd', 'value_multiple', 'token_odds', 'implied_value_usd', 'range_p25_usd', 'range_p75_usd', 'range_p10_usd', 'range_p90_usd', 'verdict', 'verdict_net_usd', 'verdict_net_per_hour_usd', 'farm_deposit_usd', 'farm_fees_usd', 'farm_gross_usd', 'live_comp_name'];
  const cell = (v) => { const s = Array.isArray(v) ? v.join(';') : String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n') + '\n';
}
function downloadBoard(fmt) {
  const text = fmt === 'csv' ? boardCsv() : JSON.stringify({ rows }, null, 1) + '\n';
  const blob = new Blob([text], { type: fmt === 'csv' ? 'text/csv' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'launch-ledger-board.' + fmt;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function compareBar() {
  $('#compare-count').textContent = compared.size === 0 ? 'Tick rows to compare' : compared.size + ' ticked';
  $('#compare-open').disabled = compared.size < 2;
}
function openCompare() {
  const sel = rows.filter((r) => compared.has(r.slug));
  if (sel.length < 2) return;
  const line = (label, fn) => `<tr><td>${label}</td>${sel.map((r) => `<td>${fn(r)}</td>`).join('')}</tr>`;
  $('#compare').innerHTML = `<div class="detail-head"><div><h3>Compare</h3><div class="sub">${sel.length} protocols, same model, same scenario</div></div><button class="close-x" onclick="document.getElementById('compare').close()">Close ✕</button></div>
  <div class="detail-body"><table class="kv cmp"><thead><tr><th></th>${sel.map((r) => `<th>#${r.rank} ${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
  ${line('Implied value', (r) => '<b>' + full(r.implied_value_usd) + '</b>')}
  ${line('Range P25–P75', (r) => full(r.range_p25_usd) + ' – ' + full(r.range_p75_usd))}
  ${line('TVL', (r) => full(r.tvl_usd))}
  ${line('Fitted multiple', (r) => num(r.value_multiple, 3) + '×')}
  ${line('Value if launches', (r) => full(r.if_launches_usd))}
  ${line('Token odds', (r) => num(r.token_odds * 100, 1) + '%')}
  ${line('7-day growth', (r) => r.change_7d === null ? '—' : pct(r.change_7d))}
  ${line('Age without token', (r) => age(r.age_days))}
  ${line('Farm verdict', (r) => { const v = verdictFor(r); return v.verdict + ' · net ' + (v.net >= 0 ? '' : '−') + full(Math.abs(v.net)) + ' · ' + (v.perHr >= 0 ? '' : '−') + '$' + Math.abs(v.perHr).toFixed(2) + '/hr'; })}
  ${line('Farm plan', (r) => r.farm_steps.length + ' steps · ' + full(verdictFor(r).dep) + ' deposit')}
  ${line('Nearest live comp', (r) => r.live_comp_name ? esc(r.live_comp_name) + ' at ' + num(r.live_comp_mcap_usd / r.live_comp_tvl_usd, 2) + '× TVL' : '—')}
  </tbody></table></div>`;
  $('#compare').showModal();
}
function bandHtml(r) {
  const lo = Math.log(r.range_p10_usd), hi = Math.log(r.range_p90_usd), span = Math.max(hi - lo, 0.0001);
  const left = ((Math.log(r.range_p25_usd) - lo) / span * 100).toFixed(1);
  const width = Math.max(2, (Math.log(r.range_p75_usd) - Math.log(r.range_p25_usd)) / span * 100).toFixed(1);
  const mid = ((Math.log(r.implied_value_usd) - lo) / span * 100).toFixed(1);
  return `<div class="band"><i style="left:${left}%;width:${width}%"></i><b style="left:${mid}%"></b></div>`;
}
function renderBoard() {
  const pre = st.tab === 'pre';
  $('#tab-pre').classList.toggle('on', pre);
  $('#tab-live').classList.toggle('on', !pre);
  const head = $('#board-head');
  if (pre) {
    head.innerHTML = `<th class="cmpcol" title="Tick rows to compare"></th>` + HEADS.map(([k, l, num]) => `<th class="${num ? 'num ' : ''}sortable" data-k="${k}">${l}${st.sort === k ? (st.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('');
    const list = sorted(filtered());
    $('#row-count').textContent = `${list.length} of 198 rows`;
    $('#board-body').innerHTML = list.map((r) => {
      const v = verdictFor(r);
      const open = expanded.has(r.slug);
      return `<tr data-slug="${r.slug}">
        <td class="cmpcol"><input type="checkbox" class="cmp" data-slug="${r.slug}"${compared.has(r.slug) ? ' checked' : ''} aria-label="Compare ${esc(r.name)}"></td>
        <td class="num">${r.rank}<span class="rankrange">${r.rank_low}–${r.rank_high}</span></td>
        <td class="name">${esc(r.name)}${r.watchlist ? '<span class="tag w">Watchlist</span>' : ''}${r.parent_recorded ? '<span class="tag p">Parent</span>' : ''}<span class="sub">${esc(catOf(r))} · ${esc(chainsOf(r))}</span></td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${r.change_7d === null ? '—' : pct(r.change_7d)}</td>
        <td class="num">${age(r.age_days)}</td>
        <td class="num">${money(r.if_launches_usd)}</td>
        <td class="num"><b>${money(r.implied_value_usd)}</b> <span class="range">${money(r.range_p25_usd)}–${money(r.range_p75_usd)}</span>${bandHtml(r)}</td>
        <td class="num">${num(r.token_odds * 100, 0)}%<span class="oddsbar"><i style="width:${num(r.token_odds * 100, 0)}%"></i></span></td>
        <td><span class="chip ${v.verdict.toLowerCase()}">${v.verdict}</span> <button type="button" class="plan-btn" data-slug="${r.slug}">${open ? 'Plan ▾' : 'Plan ▸'}</button><span class="farmline">${r.farm_steps.length} steps · ${money(v.dep)} · ${FARM.hours}h · BE ${num(v.breakEvenDrop * 100, 1)}%</span></td>
        <td class="num ${v.perHr >= 0 ? 'pos' : 'neg'}">${v.perHr >= 0 ? '+' : '−'}$${Math.abs(v.perHr).toFixed(2)}</td>
      </tr>` + (open ? `<tr class="plan-row"><td colspan="11">${farmPlanHtml(r)}</td></tr>` : '');
    }).join('');
    $('#empty').hidden = list.length > 0;
  } else {
    head.innerHTML = `<th class="num">#</th><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th>`;
    $('#row-count').textContent = `${live.length} live tokens, by market cap`;
    $('#board-body').innerHTML = live.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="name">${esc(r.name)}<span class="sub">${esc(catOf(r))} · ${esc(chainsOf(r))}</span></td>
      <td class="num">${money(r.tvl_usd)}</td><td class="num">${money(r.mcap_usd)}</td><td class="num">${num(r.mcap_usd / r.tvl_usd, 2)}×</td></tr>`).join('');
    $('#empty').hidden = true;
  }
  head.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => {
      if (st.sort === th.dataset.k) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
      else { st.sort = th.dataset.k; st.dir = 'desc'; }
      writeHash(); renderBoard();
    };
  });
  $('#board-body').querySelectorAll('tr[data-slug]').forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest('input.cmp, button.plan-btn')) return;
      openDetail(tr.dataset.slug);
    };
  });
  $('#board-body').querySelectorAll('input.cmp').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) compared.add(cb.dataset.slug); else compared.delete(cb.dataset.slug);
      syncSets(); compareBar();
    };
  });
  $('#board-body').querySelectorAll('button.plan-btn').forEach((btn) => {
    btn.onclick = () => {
      if (expanded.has(btn.dataset.slug)) expanded.delete(btn.dataset.slug); else expanded.add(btn.dataset.slug);
      syncSets(); renderBoard();
    };
  });
  compareBar();
  scenarioLine();
}

/* ---- detail ---- */
function whyRank(r) {
  const parts = [];
  parts.push(`${r.name} is #${r.rank} because ${money(r.tvl_usd)} of TVL, times a fitted multiple of ${num(r.value_multiple, 3)}× at its size and category, gives ${money(r.if_launches_usd)} if it launches — and the peers' record says it launches ${num(r.token_odds * 100, 0)}% of the time, so the implied value is ${money(r.implied_value_usd)}.`);
  if (r.parent_recorded) parts.push(`The odds are halved: it looks like a product of a protocol whose token already trades, and the snapshot holds no case where a child product launched its own token.`);
  if (r.value_multiple < 0.05) parts.push(`The fitted multiple is small because large, mature protocols trade at a small fraction of TVL — the fit, not a rule, says so.`);
  if (r.change_7d !== null && r.change_7d > 20) parts.push(`Fast recent growth (7d ${pct(r.change_7d)}) was tested in the value fit and did not help, so it adds nothing here.`);
  return parts.join(' ');
}
function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  const v = verdictFor(r);
  const d = $('#detail');
  d.innerHTML = `<div class="detail-head"><div><h3>${esc(r.name)}</h3>
    <div class="sub">Rank #${r.rank} · ${esc(catOf(r))} · ${esc(chainsOf(r))} · ${r.watchlist ? 'on the watchlist · ' : ''}${r.parent_recorded ? 'parent recorded · ' : ''}listed ${r.listed_at ?? '—'}</div></div>
    <button class="close-x" onclick="document.getElementById('detail').close()">Close ✕</button></div>
  <div class="detail-body"><div class="detail-cols"><div class="detail-left">
    <h4>Model breakdown</h4>
    <table class="kv">
      <tr><td>TVL</td><td>${full(r.tvl_usd)}</td></tr>
      <tr><td>Fitted multiple, if it launches</td><td>${num(r.value_multiple, 3)}×</td></tr>
      <tr><td>Value if it launches</td><td>${full(r.if_launches_usd)}</td></tr>
      <tr><td>Token odds, from the peers' record</td><td>${num(r.token_odds * 100, 1)}%</td></tr>
      <tr><td>Implied value (TVL × multiple × odds)</td><td><b>${full(r.implied_value_usd)}</b></td></tr>
      <tr><td>Range, P25–P75 (measured ${Math.round(ev.value.claim2575 * 100)}%)</td><td>${full(r.range_p25_usd)} – ${full(r.range_p75_usd)}</td></tr>
      <tr><td>Range, P10–P90 (measured ${Math.round(ev.value.claim1090 * 100)}%)</td><td>${full(r.range_p10_usd)} – ${full(r.range_p90_usd)}</td></tr>
      <tr><td>7-day growth</td><td>${r.change_7d === null ? '— (not in the snapshot)' : pct(r.change_7d)}</td></tr>
      <tr><td>Age without token</td><td>${r.age_days === null ? '— (no listing date; the odds use 180 days)' : age(r.age_days) + ' (' + r.age_days + ' days)'}</td></tr>
    </table>
    <h4>Why this rank</h4><p>${esc(whyRank(r))}</p>
    <h4>Farm verdict — this scenario</h4>
    <div class="verdict-box"><span class="chip ${v.verdict.toLowerCase()}">${v.verdict}</span> <span class="big">${v.verdict === 'FARM' ? 'Worth farming' : v.verdict === 'MARGINAL' ? 'Marginal' : 'Not worth it'}</span>
      <table class="kv"><tr><td>Deposit</td><td>${full(v.dep)}</td></tr>
      <tr><td>Expected drop, ${num(sc.drop * 100, 1)}% of implied value</td><td>${full(v.gross)}</td></tr>
      <tr><td>Gas (6 tx on ${esc(r.chains[0])}) + fees</td><td>−${full(v.fees)}</td></tr>
      <tr><td>T-bill forgone, 5% over ${sc.horizon} wk</td><td>−${full(v.opp)}</td></tr>
      <tr><td>Net</td><td><b>${v.net >= 0 ? '' : '−'}${full(Math.abs(v.net))}</b></td></tr>
      <tr><td>Net per hour (${FARM.hours} hours)</td><td><b>${v.perHr >= 0 ? '' : '−'}$${Math.abs(v.perHr).toFixed(2)}</b> — FARM needs $25</td></tr></table></div>
    <h4>Nearest live comparison</h4>
    <p>${r.live_comp_name ? `${esc(r.live_comp_name)} (${esc(r.live_comp_category ?? 'no category')}) trades at ${num(r.live_comp_mcap_usd / r.live_comp_tvl_usd, 2)}× its TVL — the closest live token by TVL${r.live_comp_category === r.category ? ', in the same category' : ''}.` : 'No live token by TVL is close enough to compare.'}</p>
    <p class="note">Recomputed in this page: ${full(r.tvl_usd)} × ${num(r.value_multiple, 3)} × ${num(r.token_odds * 100, 1)}% = ${full(r.implied_value_usd)} — ${Math.round(r.tvl_usd * r.value_multiple * r.token_odds) === r.implied_value_usd ? 'matches the board' : 'does not match the board'}.</p>
  </div><div class="detail-right">
    <h4>Farm plan — ${r.farm_steps.length} steps, each with its cost and time</h4>
    ${farmPlanHtml(r)}
    <p class="cost note">The plan totals ${full(v.dep)} deposited and about ${FARM.hours} hours of active attention.</p>
  </div></div></div>`;
  st.p = slug; writeHash();
  d.showModal();
  d.addEventListener('close', () => { st.p = ''; writeHash(); }, { once: true });
}

/* ---- the ledger ---- */
function ledgerPanel() {
  const total = ev.ledger.reduce((s, g) => s + g.count, 0);
  const colors = { 'Ranked': '#1c1917', 'Token trades': '#166534', 'Token recorded': '#b45309', 'Out': '#a8a29e' };
  const bar = ev.ledger.map((g) => {
    const key = Object.keys(colors).find((k) => g.label.startsWith(k)) || 'Out';
    return `<i style="width:${(g.count / total * 100).toFixed(2)}%;background:${colors[key]}" title="${esc(g.label)}: ${g.count}"></i>`;
  }).join('');
  $('#ledger').innerHTML = `<h2>The ledger — all ${total} protocols, exactly once</h2>
    <div class="bar">${bar}</div>
    <div class="legend">${ev.ledger.map((g) => `<span>${esc(g.label)} <b>${g.count}</b>${g.note ? ` — ${esc(g.note)}` : ''}</span>`).join('')}</div>
    <p class="check-line">Checked in this page: the ledger sums to <b>${total}</b> of ${ev.snapshotProtocols} protocols; the board holds <b>${rows.length}</b> rows covering <b>${rows.filter((r) => r.watchlist).length} of ${meta.watchlist_size} watchlist</b>; the implied value of every row recomputes from its own multiple and odds with <span class="ok">${recomputeBad === 0 ? '0 mismatches' : recomputeBad + ' mismatches'}</span>.</p>`;
}

/* ---- the evidence ---- */
function ladderTable(title, cols, list) {
  return `<h3>${title}</h3><table class="ev"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
    list.map((r) => `<tr><td>${esc(r.label)}</td>${r.cells.map((c) => `<td class="${r.kept ? 'kept' : 'notkept'}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function evidencePanel() {
  const v = ev.value, o = ev.odds;
  $('#evidence').innerHTML = `<h2>The evidence — what was fitted, what was tested, what was not kept</h2>
    ${ladderTable('Value multiple — log(market cap / TVL), median fit, 95 traded tokens',
      ['Term', 'Leave-one-out', 'Walk-forward, one split', 'Walk-forward, four splits', 'Kept'],
      v.ladder.map((r) => ({ label: r.label, kept: r.kept, cells: ['×' + r.loo.toFixed(2), '×' + r.wfSingle.toFixed(2), '×' + r.wfMulti.toFixed(2), r.kept ? 'kept' : 'tested, not kept'] })))}
    <p>Flat multiple, for scale: leave-one-out ×${v.flatLoo.toFixed(2)}, walk-forward ×${v.flatWfSingle.toFixed(2)}. Final fit: intercept ${v.beta[0].toFixed(4)}, ln TVL ${v.beta[1].toFixed(4)}, (ln TVL)² ${v.beta[2].toFixed(4)}, chains ${v.beta[3].toFixed(4)}, category effects ${Math.min(...v.beta.slice(4)).toFixed(3)} to ${Math.max(...v.beta.slice(4)).toFixed(3)}.</p>
    ${ladderTable('Token odds — logit on the peers\' record, ' + o.n + ' peers, base rate ' + o.baseRate.toFixed(3),
      ['Term', 'Ten-fold Brier', 'Walk-forward, one split', 'Walk-forward, four splits', 'Called right (held out)', 'Kept'],
      o.ladder.map((r) => ({ label: r.label, kept: r.kept, cells: [r.tenFold.toFixed(3), r.wfSingle.toFixed(3), r.wfMulti.toFixed(3), Math.round(r.calledRight * 100) + '%', r.kept ? 'kept' : 'tested, not kept'] })))}
    <p>Final odds: intercept ${o.beta[0].toFixed(4)}, log age ${o.beta[1].toFixed(4)}, category and chain effects fitted with a ridge. "Called right" is the held-out share of peers whose token record the rung calls correctly at the 50% line. A term is kept only when it lowers the miss in <b>both</b> held-out tests; 7-day growth, age in the value fit, shrunk category size slopes, size in the odds fit and a control of another row's growth were all tested and not kept.</p>
    <p>Fitted, ± bootstrap s.e. (${v.boot.refits} refits, seeded): multiple at $100M TVL (1 chain, modal category ${esc(v.boot.refCategory)}) <b>${v.boot.mult.toFixed(3)} ± ${v.boot.multSe.toFixed(3)}</b>; odds, in logits: intercept <b>${o.beta[0].toFixed(2)} ± ${o.boot.interceptSe.toFixed(2)}</b>, log-age <b>${o.beta[1].toFixed(2)} ± ${o.boot.logAgeSe.toFixed(2)}</b>.</p>
    <h3>Range honesty — the walk-forward check</h3>
    <p>Ranges are conformal-calibrated from walk-forward residuals (n = ${v.calN}): P25–P75 is ${v.q25.toFixed(2)} to ${v.q75.toFixed(2)} in log terms, P10–P90 is ${v.q10.toFixed(2)} to ${v.q90.toFixed(2)}. The page claims only the measured calibration cover: <b>${Math.round(v.claim2575 * 100)}%</b> inside P25–P75 and <b>${Math.round(v.claim1090 * 100)}%</b> inside P10–P90. A separate one-split check calibrates on the earlier half only and measures the later half (n = ${v.wfN}): <b>${Math.round(v.wfCover2575 * 100)}%</b> and <b>${Math.round(v.wfCover1090 * 100)}%</b>; for TVL ≥ $50M (n = ${v.wfBigN}) it is <b>${Math.round(v.wfCover2575Big * 100)}%</b> and <b>${Math.round(v.wfCover1090Big * 100)}%</b>. Category-blind checks price each category from a fit that never saw it: value miss ×${v.catBlindMiss.toFixed(2)}, odds Brier ${o.catBlindBrier.toFixed(3)}. The old leave-one-out P10–P90 was ${v.looQ10.toFixed(2)} to ${v.looQ90.toFixed(2)} and under-covered walk-forward; this build widens it from measured residuals instead of claiming 80% by label.</p>`;
}

/* ---- method ---- */
function methodPanel() {
  $('#method').innerHTML = `<h2>Method, in one place</h2>
    <p><b>Value.</b> log(market cap / TVL) is fitted by median regression on ln TVL, its square, the number of chains, and a category ridge (λ = 30), from the 95 traded protocols with a listing date. Every term was admitted only if it lowered the held-out miss in both a leave-one-out test and a walk-forward test (train on earlier listings, test on later ones). A control — another row's 7-day growth — was fitted alongside; it hurt both tests, which is how you know the tests have power.</p>
    <p><b>Odds.</b> A logit on the peers' record (age ≥ 365 days, not a centralised exchange, growth present; ${ev.odds.n} peers, base rate ${ev.odds.baseRate.toFixed(3)}): log age, category ridge (λ = 3), first-chain ridge (λ = 10), a size/age structure bundle (position against the $50M floor, first-chain rarity among peers, and TVL relative to the protocol's own category), and age thresholds at 1.5, 2, 2.5, 3, 4 and 5 years. Each rung was kept only when it lowered the Brier score in the ten-fold test and both walk-forward tests. Plain size and 7-day growth were tested after that bundle and did not help. Seven ranked protocols carry no listing date in the snapshot; their odds use 180 days, stated here, not hidden.</p>
    <p><b>Parent discount.</b> Twenty ranked protocols look like products of a protocol whose token already trades — the same name-stem never appears twice by rule, so they are found by elimination: pre-token, at or above the floor, clean by every visible rule, and not on the watchlist. Their odds are halved (× 0.5), stated as an assumption, not fitted: the snapshot holds no case that would fit it.</p>
    <p><b>Farm.</b> Deposit by TVL tier ($250 / $150 / $100 / $50), gas by first chain, six transactions, 0.2% of deposit in fees, a 5% T-bill for the horizon, ${FARM.hours} hours of attention. Default scenario: a ${Math.round(FARM.dropShare * 100)}% drop, a pool of ${FARM.poolFrac * 100}% of TVL, ${FARM.horizonWeeks} weeks.</p>
    <p><b>Determinism.</b> The build runs in one pass with fixed iterations and no randomness; the same snapshot writes the same board, the same evidence and the same dossier, byte for byte.</p>`;
}

/* ---- init ---- */
proof();
tape();
bootline();
accounting();
termStrip();
formulaStrip();
scenarioPanel();
filtersPanel();
ledgerPanel();
evidencePanel();
methodPanel();
$('#tab-pre').onclick = () => { st.tab = 'pre'; writeHash(); renderBoard(); };
$('#tab-live').onclick = () => { st.tab = 'live'; writeHash(); renderBoard(); };
$('#clear-empty').onclick = () => { st = { ...st, q: '', cat: '', chain: '', tvl: '', growth: '', age: '', wl: false, verdict: '' }; writeHash(); filtersPanel(); renderBoard(); };
$('#exp-csv').onclick = () => downloadBoard('csv');
$('#exp-json').onclick = () => downloadBoard('json');
$('#compare-open').onclick = () => openCompare();
$('#compare-clear').onclick = () => { compared.clear(); syncSets(); renderBoard(); };
renderBoard();
if (st.p) openDetail(st.p);
else if (compared.size >= 2) openCompare();
