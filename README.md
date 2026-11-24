# Token Launch Radar — radar-4 ("The Launch Ledger")

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/alpha-working/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/alpha-working/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: it ranks the protocols whose token does not
exist yet by an implied value fitted from the snapshot's own record, and shows
a reader how to farm each one.

## Model (radar-4)

- **Value multiple, fitted not ruled.** `log(mcap / TVL)` is fitted by median
  regression on the 95 traded tokens in the snapshot (ln TVL, its square,
  chain count, category ridge). Every term is kept only if it lowers the
  held-out miss in both a leave-one-out test and a walk-forward test
  (leave-one-out x2.91, walk-forward x2.44, vs a flat x5.00 baseline).
- **Token odds, from the peers' record.** A logit on 442 peers (base rate
  0.595) estimates the chance a protocol records a token; Brier 0.197
  ten-fold, 0.227 walk-forward. Implied value = TVL x fitted multiple x
  token odds. Protocols that look like products of a token that already
  trades get their odds halved (x0.5, found by elimination, never by name).
- **Honest ranges.** P25-P75 and P10-P90 from the leave-one-out residuals,
  with a walk-forward calibration check (52% inside P25-P75, stated 50%;
  67% inside P10-P90, stated 80% — the shortfall is stated on the page).
- **Farm verdicts.** FARM / MARGINAL / SKIP, net of gas and fees against a
  T-bill and $25 an hour, with interactive scenario controls (deposit, drop
  share, horizon). Each of the 198 rows carries 9 concrete farm steps with
  cost and time.
- **Ledger.** All 758 snapshot protocols are accounted for in exactly one
  group (40 watchlist ranked, 138 early, 20 off-list parent-recorded,
  the rest token-trading or out by the house list's own rules).

Nothing is hardcoded by name. A protocol is said to record no token, never
to have none.

## Board

198 rows: the 40 watchlist protocols plus 158 launch-like protocols below
the floor. Top 5: Steakhouse Financial $30.1M, Gauntlet $20.9M, USDD $19.6M,
Veda $14.9M, Upshift $13.8M. Sentora Curator, radar-3's #1 at $185M, is
#10 at $10.0M — the fitted multiple at its size is 0.033x and the parent
discount halves its odds to 11%.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only, no network. Two runs write identical bytes.
Verified: 7/7 gates pass, coverage 40/40, in-page recompute 0 mismatches.

## Dashboard

`dashboard/` is a static page (no network): the board, a detail view per
protocol, filters (category, chain, TVL, growth, age, verdict, watchlist),
8 sorts, scenario controls, the evidence tables and the 758-protocol ledger.
Editorial ledger theme: warm paper, ink, copper, Georgia serif.

Bounty: https://make.fun/bounty/token-radar-01

---

Entered on [make.fun](https://make.fun/?ref=d397ay5y&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
