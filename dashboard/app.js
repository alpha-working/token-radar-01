// Token Radar dashboard v2. Reads window.RADAR, renders board, filters, sorts and detail.
// No network: every byte shown is in data.js. Model recomputed here must match lib/model.ts.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tvl: 'all', growth: 'all', age: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtDate(s) { return s || 'unknown'; }
  // Model radar-2, identical to lib/model.ts: base 250k*(TVL/1e6)^0.85, log growth, exp maturity.
  function impliedOf(row, model) {
    var m = model || DATA.model;
    var base = m.base_scale * Math.pow(row.tvl_usd / m.tvl_divisor, m.tvl_exponent);
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var gm;
    if (g >= 0) gm = 1 + m.growth_pos_weight * Math.log1p(g / m.growth_pos_scale) / m.growth_pos_denom;
    else if (g >= m.growth_steep_threshold) gm = 1 - m.growth_neg_weight * Math.log1p(Math.abs(g) / m.growth_neg_scale) / m.growth_neg_denom;
    else gm = Math.max(m.growth_floor_mult, 0.75 - m.growth_steep_slope * (Math.abs(g) - 30));
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var mat = m.maturity_floor + m.maturity_range * (1 - Math.exp(-age / m.maturity_scale_days));
    if (row.age_days === null || row.age_days === undefined) mat = mat * m.unknown_penalty;
    return Math.max(1, Math.round(base * gm * mat));
  }
  function growthMultOf(row, model) {
    var m = model || DATA.model;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    if (g >= 0) return 1 + m.growth_pos_weight * Math.log1p(g / m.growth_pos_scale) / m.growth_pos_denom;
    if (g >= m.growth_steep_threshold) return 1 - m.growth_neg_weight * Math.log1p(Math.abs(g) / m.growth_neg_scale) / m.growth_neg_denom;
    return Math.max(m.growth_floor_mult, 0.75 - m.growth_steep_slope * (Math.abs(g) - 30));
  }
  function maturityMultOf(row, model) {
    var m = model || DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var mat = m.maturity_floor + m.maturity_range * (1 - Math.exp(-age / m.maturity_scale_days));
    if (row.age_days === null || row.age_days === undefined) mat = mat * m.unknown_penalty;
    return mat;
  }
  function baseOf(row, model) {
    var m = model || DATA.model;
    return m.base_scale * Math.pow(row.tvl_usd / m.tvl_divisor, m.tvl_exponent);
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  // Farm plan mirrors lib/model.ts: category, chain gas, TVL capital, age hold.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 'about $8';
    if (c.indexOf('solana') >= 0) return 'under $0.10';
    if (c.indexOf('base') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('unichain') >= 0 || c.indexOf('ink') >= 0 || c.indexOf('katana') >= 0 || c.indexOf('tempo') >= 0 || c.indexOf('arc') >= 0 || c.indexOf('corn') >= 0 || c.indexOf('monad') >= 0) return 'under $1';
    if (c.indexOf('binance') >= 0 || c.indexOf('polygon') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('bitcoin') >= 0 || c.indexOf('hyperliquid') >= 0) return 'about $1';
    return 'about $2';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s main yield vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Borrow $20 of USDC against the supplied collateral on ' + name + ', then repay it within a week while keeping the health factor above 2.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Claim the trading fees once from ' + name + ', then add the claimed fees back into the same pool on ' + chain + '.';
    if (c.indexOf('bridge') >= 0) return 'Use the bridged funds for one swap or deposit on the destination chain, then keep a small balance there for the next week.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Check the operator or validator set for ' + name + ' and confirm the stake receipt shows the correct amount and chain.';
    if (c.indexOf('rwa') >= 0) return 'Check the redemption window and the backing report for ' + name + ' before the hold ends, and confirm the asset can be redeemed on ' + chain + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return "Review the vault's current allocation and curator fee for " + name + ', and confirm the vault caps allow a second deposit.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge on ' + name + ', record the result, then reopen a smaller position only if the market is open.';
    if (c.indexOf('prediction') >= 0) return 'Settle or close the market position on ' + name + ' and record the outcome before opening another one.';
    if (c.indexOf('insurance') >= 0) return 'Confirm the cover expiry date and the claim window for ' + name + ' in its policy page on ' + chain + '.';
    if (c.indexOf('yield') >= 0) return 'Harvest or compound the yield once on ' + name + ' and record the amount harvested in the farm log.';
    if (c.indexOf('stable') >= 0) return 'Check the peg and the redemption fee for ' + name + ' before minting any more of the stable asset.';
    return 'Make a second small deposit in ' + name + ' on ' + chain + ' and confirm it appears in the activity history.';
  }
  function riskCheckFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Check the health factor and the borrow rate once a week; top up collateral if the health factor falls below 2.';
    if (c.indexOf('dex') >= 0) return 'Check the pool range, fees earned and price move once a week; adjust the range only if fees stop accruing.';
    if (c.indexOf('bridge') >= 0) return 'Check the bridge status and the destination balance once a week; do not bridge again while a transfer is pending.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Check the operator uptime and the unbonding period once a week; note any slashing or downtime warning.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Check the vault allocation, curator fee and any redemption queue once a week; note changes before adding funds.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Check margin, funding and liquidation price once a week; reduce the position if margin falls below your limit.';
    return 'Check the position health, fees and the protocol\'s own announcements once a week on ' + chain + '; note any change before adding funds.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: gas + ' of gas and $20 of capital in the second action', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' of gas a week', time: '10 minutes a week' },
      { text: "Open the protocol's own points or rewards page from its official site and check eligibility; claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: riskCheckFor(p, chain), cost: gas + ' of gas if you adjust the position', time: '10 minutes a week' },
      { text: 'Unwind in two parts: withdraw half, confirm it arrives in the fresh wallet, then withdraw the rest and close the position.', cost: gas + ' of gas to unwind', time: '20 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it later.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  function whyRank(row) {
    var tvlPart = row.tvl_usd >= 1e9 ? 'very large TVL' : row.tvl_usd >= 1e8 ? 'large TVL' : 'modest TVL';
    var g = row.change_7d;
    var growthPart = g === null ? 'no 7d growth reported' : g > 0 ? 'growing +' + g.toFixed(2) + '%' : g < -30 ? 'steeply down ' + g.toFixed(2) + '%' : 'down ' + g.toFixed(2) + '%';
    var agePart = row.age_days === null ? 'age unknown (penalised)' : row.age_days >= 365 ? 'over a year old' : row.age_days >= 180 ? '6-12 months old' : 'under 6 months old';
    return 'Rank ' + row.rank + ': ' + tvlPart + ' (' + fmtUsd(row.tvl_usd) + '), ' + growthPart + ', ' + agePart + ' — so base ' + fmtUsd(row.base_usd) + ' x growth ' + row.growth_multiplier.toFixed(4) + ' x maturity ' + row.maturity_multiplier.toFixed(4) + ' = ' + fmtUsd(row.implied_value_usd) + '.';
  }
  function activeFilterCount() {
    var n = 0;
    if (state.q) n++;
    if (state.category !== 'all') n++;
    if (state.chain !== 'all') n++;
    if (state.tvl !== 'all') n++;
    if (state.growth !== 'all') n++;
    if (state.age !== 'all') n++;
    if (state.watch) n++;
    return n;
  }
  function clearFilters() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 'all'; state.growth = 'all'; state.age = 'all'; state.watch = false;
    writeHash(); render();
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = params.get('tvl');
    if (params.get('growth')) state.growth = params.get('growth');
    if (params.get('age')) state.age = params.get('age');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl !== 'all') params.set('tvl', state.tvl);
    if (state.growth !== 'all') params.set('growth', state.growth);
    if (state.age !== 'all') params.set('age', state.age);
    if (state.watch) params.set('watch', '1');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.tvl !== 'all') {
        if (state.tvl === 'under50' && r.tvl_usd >= 5e7) return false;
        if (state.tvl === '50-500' && (r.tvl_usd < 5e7 || r.tvl_usd >= 5e8)) return false;
        if (state.tvl === '500-1000' && (r.tvl_usd < 5e8 || r.tvl_usd >= 1e9)) return false;
        if (state.tvl === 'over1b' && r.tvl_usd < 1e9) return false;
      }
      if (state.growth !== 'all') {
        var g = r.change_7d === null ? 0 : r.change_7d;
        if (state.growth === 'growing' && !(g > 0)) return false;
        if (state.growth === 'flat' && !(g >= -5 && g <= 0)) return false;
        if (state.growth === 'declining' && !(g < -5)) return false;
      }
      if (state.age !== 'all') {
        if (state.age === 'unknown' && r.age_days !== null) return false;
        if (state.age === 'under180' && !(r.age_days !== null && r.age_days < 180)) return false;
        if (state.age === '180-365' && !(r.age_days !== null && r.age_days >= 180 && r.age_days < 365)) return false;
        if (state.age === 'over365' && !(r.age_days !== null && r.age_days >= 365)) return false;
      }
      if (state.watch && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'value-per-tvl') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }
  function lede() {
    var excluded = DATA.excluded_size !== undefined ? DATA.excluded_size : 91;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The radar adds ' + DATA.early_size + ' pre-token protocols, for ' + DATA.board_size + ' rows in total. Wrapped, staked and bridge products are set aside, not ranked: they are not new launches. ' + excluded + ' such protocols were excluded, following the same rule as the watchlist. Implied value is a model, not a promise. Records no token means DefiLlama records no token.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside (wrapped/staked/bridge)' }), el('b', { text: String(excluded) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }
  function opt(v, t, sel) { return el('option', { value: v, text: t, selected: v === sel ? 'selected' : null }); }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' }, opt('all', 'All categories', state.category), categories.map(function (c) { return opt(c, c, state.category); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' }, opt('all', 'All chains', state.chain), chains.map(function (c) { return opt(c, c, state.chain); }));
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var tv = el('select', { id: 'tvl', 'aria-label': 'Filter by TVL' }, opt('all', 'All TVL', state.tvl), opt('under50', 'Under $50M', state.tvl), opt('50-500', '$50M-$500M', state.tvl), opt('500-1000', '$500M-$1B', state.tvl), opt('over1b', 'Over $1B', state.tvl));
    tv.addEventListener('change', function () { state.tvl = tv.value; writeHash(); render(); });
    var gr = el('select', { id: 'growth', 'aria-label': 'Filter by growth' }, opt('all', 'All growth', state.growth), opt('growing', 'Growing (>0%)', state.growth), opt('flat', 'Flat (-5% to 0%)', state.growth), opt('declining', 'Declining (<-5%)', state.growth));
    gr.addEventListener('change', function () { state.growth = gr.value; writeHash(); render(); });
    var ag = el('select', { id: 'age', 'aria-label': 'Filter by age' }, opt('all', 'All ages', state.age), opt('under180', 'Under 180 days', state.age), opt('180-365', '180-365 days', state.age), opt('over365', 'Over 1 year', state.age), opt('unknown', 'Age unknown', state.age));
    ag.addEventListener('change', function () { state.age = ag.value; writeHash(); render(); });
    var watchBtn = el('button', { type: 'button', class: 'toggle' + (state.watch ? ' on' : ''), 'aria-pressed': state.watch ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watch = !state.watch; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var n = activeFilterCount();
    var clear = el('button', { class: 'button', type: 'button', text: n > 0 ? 'Clear filters (' + n + ')' : 'Clear filters', onclick: clearFilters });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL' }), tv),
      el('div', { class: 'field' }, el('label', { for: 'growth', text: 'Growth' }), gr),
      el('div', { class: 'field' }, el('label', { for: 'age', text: 'Age' }), ag),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Watchlist' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: (state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols') + (n > 0 ? ' — ' + n + ' filter' + (n === 1 ? '' : 's') + ' active' : '') }),
      clear
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }
  function sortBar() {
    var sorts = [['implied', 'Implied'], ['tvl', 'TVL'], ['growth', 'Growth'], ['age', 'Age'], ['name', 'Name'], ['value-per-tvl', 'Value / TVL']];
    return el('div', { class: 'sortbar' }, el('span', { class: 'sub', text: 'Sort: ' }),
      sorts.map(function (s) {
        return el('button', { type: 'button', class: state.sort === s[0] ? 'sort on' : 'sort', text: s[1] + (state.sort === s[0] ? (state.dir < 0 ? ' v' : ' ^') : ''), onclick: function () { if (state.sort === s[0]) state.dir = -state.dir; else { state.sort = s[0]; state.dir = -1; } writeHash(); render(); } });
      }));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: clearFilters })
      ));
    }
    var top10 = DATA.rows.slice(0, 10);
    var max = top10.length ? top10[0].implied_value_usd : 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.watchlist ? ' — watchlist' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) + (r.age_unknown ? ' *' : '') }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan. * = age unknown.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }
  function modelPanel() {
    var m = DATA.model;
    var top = DATA.rows[0];
    var ex = top ? 'Example — rank 1 ' + top.name + ': base ' + fmtUsd(top.base_usd) + ' x growth ' + top.growth_multiplier.toFixed(4) + ' x maturity ' + top.maturity_multiplier.toFixed(4) + ' = ' + fmtUsd(top.implied_value_usd) + '.' : '';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed (radar-3)' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of TVL, 7-day growth and age. No protocol name is special-cased. Growth is log-compressed, so +4,448% is not the same as +120%. Decline below -30% is discounted heavily. Age rises steeply to about 1 year, then plateaus.' }),
      el('p', { class: 'sub', text: 'What is ranked: only launch-like pre-token protocols. Excluded, by the same rule as the watchlist: categories Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX; names with the whole word wrapped, staked or staking; names starting with an exchange (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini); and versioned names. Those products wrap, stake or bridge a token that already trades, so ranking them as launches would mislead. All 40 watchlist protocols pass this rule.' }),
      el('div', { class: 'formula' },
        'implied = round( 250000 x (TVL / 1,000,000)^0.85 x growthMult x maturity )'
      ),
      el('div', { class: 'formula' },
        'growthMult: g>=0: 1 + 0.60 x ln(1+g/20) / ln(7);  -30<=g<0: 1 - 0.25 x ln(1+|g|/20) / ln(2.5);  g<-30: max(0.30, 0.75 - 0.01 x (|g|-30))'
      ),
      el('div', { class: 'formula' },
        'maturity = 0.55 + 0.45 x (1 - exp(-age/365));  age unknown: use 180 days, then x 0.85, flagged "age unknown".'
      ),
      el('p', { class: 'sub', text: ex + ' TVL and seven-day growth come from the snapshot. Age is the time since first listed, the best record of how long it has run with no token. This is an estimate, not a price, and not a promise a token will launch.' })
    );
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var ok = recomputed === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' — watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' — listed ' + fmtDate(row.listed_at) + (row.age_unknown ? ' — age unknown' : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('p', { class: 'why', text: whyRank(row) }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base (TVL^0.85)' }), el('b', { class: 'num', text: fmtUsd(row.base_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + (row.age_unknown ? ' (unknown)' : '') })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Recomputed in page' }), el('b', { class: 'num', text: fmtUsd(recomputed) + (ok ? ' ✓ matches' : ' ✗ differs') }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate, not a price, and not a promise a token will launch.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 9 steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(sortBar());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
