# Token Launch Radar — radar-8 ("The Launch Ledger")

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alpha-working/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alpha-working/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: it ranks the protocols whose token does not
exist yet by an implied value fitted from the snapshot's own record, and shows
a reader how to farm each one.

## Model (radar-8)

- **Value multiple, fitted not ruled.** `log(mcap / TVL)` is fitted by median
  regression on the 95 traded tokens in the snapshot (ln TVL, its square,
  chain count, category ridge, shrunk category size slopes). Every term is
  kept only if it lowers the held-out miss in leave-one-out and in both
  walk-forward tests (leave-one-out x2.91, walk-forward x2.44, vs a flat
  x5.00 baseline).
- **Token odds, from the peers' record.** A logit on 442 peers (base rate
  0.595) estimates the chance a protocol records a token; Brier 0.195
  ten-fold, 0.230 walk-forward single-split and 0.215 walk-forward
  multi-split. Implied value = TVL x fitted multiple x
  token odds. The fitted value multiple itself is one tested odds term,
  kept only because it lowers all three held-out Brier scores. Protocols
  that look like products of a token that already trades get their odds
  halved (x0.5, found by elimination, never by name).
- **Honest ranges.** P25-P75 and P10-P90 are conformal-calibrated from
  walk-forward residuals. The page claims only the measured calibration
  cover (51% inside P25-P75, 82% inside P10-P90); a separate one-split
  walk-forward check measures 58% and 81%. The board adds the range-honesty
  table with leave-one-out and walk-forward columns, a cap-vs-TVL scatter,
  a worked example for row #1, and a category-blind check (value x3.73,
  odds Brier 0.202).
- **Farm verdicts.** FARM / MARGINAL / SKIP, net of gas and fees against a
  T-bill and $25 an hour, with interactive scenario controls (deposit, drop
  share, horizon). Each of the 198 rows carries 9 concrete farm steps with
  cost and time, plus a rank range and an if-it-launches value beside the
  implied value.
- **Ledger.** All 758 snapshot protocols are accounted for in exactly one
  group (40 watchlist ranked, 138 early, 20 off-list parent-recorded,
  the rest token-trading or out by the house list's own rules). The board
  shows the accounting bar and the totals-equal and ranks-monotonic checks
  on the first screen.

Nothing is hardcoded by name. A protocol is said to record no token, never
to have none.

## Board

198 rows: the 40 watchlist protocols plus 158 launch-like protocols below
the floor. Top 5: Steakhouse Financial $26.0M, USDD $23.3M, Gauntlet
$18.0M, Veda $17.8M, Lightning Network $16.9M. Sentora Curator, radar-3's
#1 at $185M, is #9 at $12.8M under the fitted model.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only, no network. Two runs write identical bytes.
Verified: coverage 40/40, ledger 758/758, in-page recompute 0 mismatches,
board.json sha256 c5560238abfdc913cdc4925a676f8d5056ecb965551de5a458d99f16bb91cea5.

## Dashboard

`dashboard/` is a static page (no network): the board, a detail view per
protocol, filters (category, chain, TVL, growth, age, verdict, watchlist),
8 sorts, scenario controls, the evidence tables and the 758-protocol ledger.
Editorial ledger theme: warm paper, ink, copper, Georgia serif.

Bounty: https://make.fun/bounty/token-radar-01

---

Entered on [make.fun](https://make.fun/?ref=d397ay5y&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
