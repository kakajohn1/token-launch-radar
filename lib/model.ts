// Token Radar's model, version 2: fitted on the snapshot itself, every run.
//
// The board ranks every rankable protocol in the sealed snapshot — pre-token
// protocols by an implied value and live-token protocols by their market cap
// on the same scale — and sets aside the exchanges and versioned deployments
// the radar does not rank, with the reason each one is set aside.
//
// The model is fitted, not hand-picked, and it is fitted again on every run,
// from the snapshot's own figures only:
//
//   fitted FDV  = TVL x category multiple x 2.0
//   launch odds = P(token launches in the next 12 months | still tokenless),
//                 from a decreasing-hazard survival fit on the peers' record
//   implied     = fitted FDV x launch odds        (pre-token rows only)
//
// The category multiple is the geometric mean of two independent estimates:
// (a) the snapshot's own shrunk median mcap/TVL among live protocols of that
// category (ratios winsorised at 5x, log-mean shrunk toward the global median
// with a pseudo-count of 5), and (b) the external FDV/TVL comp from the
// calibration memo (research/calibration-memo.md: UNI/JUP/AAVE/MORPHO/KMNO/
// HYPE/DYDX/GMX/ENA/LDO/EIGEN/PENDLE/YFI/ONDO/SYRUP/SKY, as of 22-23 Nov
// 2026). Where one side has no value the other stands alone; where neither
// has one the global median stands. Multiples are clamped to [0.03, 1.0].
// The 2.0 uplift is the median FDV/mcap across the memo's comps: the snapshot
// records market cap, and a launch is priced on fully-diluted value.
//
// The hazard is a decreasing-hazard survival model fitted by maximum
// likelihood on (age, token) for every non-exchange, non-versioned protocol:
// P(token by age t) = 1 - exp(-H(t)), H(t) = (h0/k)(1 - exp(-k t)) x
// exp(bT (log10 TVL - 8) + bG growth), growth clamped to [-50, 150]%. The
// fitted hazard falls with age: a protocol tokenless at 30 days has roughly
// 0.7 next-12-month odds, at one year roughly 0.4, at three years under 0.1.
// That shape is fitted, not assumed: the null (constant hazard, no
// modifiers) fits worse, and the 10-fold CV AUC of the odds is reported
// in the dashboard's integrity strip, alongside the value model's own
// 10-fold CV error and its older-to-newer held-out error.
//
// No protocol name is ever special-cased: the same functions score every
// row, and every constant above is a fitted parameter or a documented
// external comp, never a per-name judgement.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** FDV/mcap uplift: the median across the calibration memo's comps. */
export const FDV_UPLIFT = 2.0;

/** Winsor cap on a live protocol's mcap/TVL when fitting multiples. */
export const RATIO_CAP = 5.0;

/** Pseudo-count shrinking a category's log-mean multiple toward the global median. */
export const SHRINK_K = 5;

/** Multiples are clamped to this band: no category is worth more than 1x TVL or less than 0.03x. */
export const MULTIPLE_FLOOR = 0.03;
export const MULTIPLE_CAP = 1.0;

/** Verdict bars on implied value (odds already inside the number). */
export const FARM_MIN_USD = 25_000_000;
export const THIN_MIN_USD = 5_000_000;

/** The model's fitted value parameters, as the dashboard states them. */
export interface ValueFit {
  /** Live protocols the multiples were fitted on. */
  n_train: number;
  /** Global median mcap/TVL among the training set. */
  global_median: number;
  /** Per-category multiple actually used (blended, clamped). */
  multiples: Record<string, number>;
  /** Per-category snapshot multiple before blending (null when no live peer). */
  snapshot_multiples: Record<string, number | null>;
  /** 10-fold CV median relative error of the full pipeline (multiple x uplift). */
  cv_median_rel_err: number;
  /** 10-fold CV mean relative error of the full pipeline. */
  cv_mean_rel_err: number;
  /** 10-fold CV median relative error of the global-median baseline. */
  cv_baseline_median_rel_err: number;
  /** Older-to-newer held-out median relative error (fit on older half, test on newer). */
  newer_median_rel_err: number;
  /** Older-to-newer held-out log-space R2 (negative means worse than the mean). */
  newer_r2: number;
}

/** The model's fitted hazard parameters, as the dashboard states them. */
export interface HazardFit {
  /** Protocols the hazard was fitted on. */
  n_fit: number;
  /** Baseline hazard at listing, per year. */
  h0: number;
  /** Hazard decay rate, per year. */
  k: number;
  /** Hazard modifier per decade of TVL. */
  bT: number;
  /** Hazard modifier per unit of clamped 7-day growth (fraction). */
  bG: number;
  /** Negative log-likelihood of the fit. */
  nll: number;
  /** Negative log-likelihood of the null (constant hazard, no modifiers). */
  nll_null: number;
  /** AUC of P(token by now) against the actual token record. */
  auc: number;
  /** 10-fold CV AUC of the odds. */
  cv_auc: number;
}

/** Everything the fit found, for the dashboard's model panel and integrity strip. */
export interface ModelFit {
  value: ValueFit;
  hazard: HazardFit;
}

/**
 * External FDV/TVL multiples per category, from the calibration memo
 * (research/calibration-memo.md, comps as of 22-23 Nov 2026). These are
 * researched constants with a stated source, not per-protocol judgements:
 * DEX 1.00 (UNI 1.45, JUP 1.14, CRV 0.54); Lending 0.15 (AAVE 0.095,
 * MORPHO 0.16, KMNO 0.20); Derivatives 1.00 (DYDX 0.91, GMX 0.44, HYPE
 * excluded as an L1/buyback outlier); RWA 0.50 (ONDO 2.9 on a mismatched
 * denominator, Maple 0.055, Plume 0.17 — flagged low-confidence); Restaking
 * and Collateral 0.10 (EIGEN 0.057, LDO 0.014); Yield and Vaults including
 * risk curators and capital allocators 0.25 (PENDLE 0.40, YFI 0.48, halved
 * because curators earn fees on AUM, not the AUM); Stablecoin/CDP and Basis
 * Trading 0.25 (SKY 0.25, ENA 0.29); Payments 0.10 (no live comp, lowest
 * defensible bucket); Chain 0.20 (capped flat: chain TVL is not protocol
 * AUM, the token is gas and security).
 */
export const MEMO_MULTIPLES: Record<string, number> = {
  Dexs: 1.0,
  Lending: 0.15,
  Derivatives: 1.0,
  RWA: 0.5,
  Restaking: 0.1,
  'Liquid Restaking': 0.1,
  'Liquid Staking': 0.05,
  'Collateral Markets': 0.1,
  'Collateral Management': 0.1,
  Yield: 0.25,
  'Yield Aggregator': 0.25,
  'Risk Curators': 0.25,
  'Onchain Capital Allocator': 0.25,
  CDP: 0.25,
  'Basis Trading': 0.25,
  'Stablecoin Wrapper': 0.25,
  'Dual-Token Stablecoin': 0.25,
  Payments: 0.1,
  Chain: 0.2,
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token' | 'live';
  /** What the value column is: a model claim, a market fact, or a model estimate where the fact is unreported. */
  value_basis: 'implied' | 'market-cap' | 'fitted';
  age_days: number | null;
  implied_value_usd: number;
  /** Fitted FDV if launched (pre-token), or the fitted FDV behind a live row whose mcap is unreported. */
  fitted_fdv_usd: number | null;
  /** Next-12-month launch odds (pre-token rows only). */
  launch_odds: number | null;
  /** Category multiple actually used. */
  multiple: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP' | 'POSITION';
  model: {
    multiple: number | null;
    fdv_usd: number | null;
    launch_odds: number | null;
    growth_pct: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A protocol the board sets aside, with the reason, for the dashboard's accountability section. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  token_status: 'pre-token' | 'live';
  reason: string;
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token' | 'live';
  value_basis: 'implied' | 'market-cap' | 'fitted';
  implied_value_usd: number;
  fitted_fdv_usd: number | null;
  launch_odds: number | null;
  multiple: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP' | 'POSITION';
  /** The farm plan (pre-token) or positioning plan (live), as board.json carries it. */
  farm_steps: string[];
}

/** Everything the dashboard needs: the board, the fit, and the set-aside list. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  pre_size: number;
  live_size: number;
  set_aside_size: number;
  farm_count: number;
  thin_count: number;
  skip_count: number;
  fit: ModelFit;
  rows: RadarRow[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** The watchlist rule's whole-word exclusion: a wrapped or staked product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories the watchlist rule keeps out: bridges, staking products and exchanges. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
/** Exchange names the watchlist rule keeps out when a name begins with one. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the
 * watchlist's own rule minus the TVL floor (the floor is the only thing that
 * separates a watchlist row from an early row). A wrapped, staked or bridged
 * product of a token that already trades is never a launch candidate, and
 * neither is an exchange or a versioned deployment of another protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** Whether a live-token protocol is one the board may rank beside the pre-token rows. */
export function isRankableLive(p: SnapshotProtocol): boolean {
  if (isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** Why a protocol is set aside instead of ranked, or null when it is ranked. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (isPreToken(p) && isRankable(p)) return null;
  if (!isPreToken(p) && isRankableLive(p)) return null;
  if (p.category === 'CEX') return 'Exchange: its token already trades elsewhere, and an exchange is not a farmable launch.';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return 'Bridged, staked or wrapped product: it is a form of a token that already trades, not a launch of its own.';
  }
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped or staked product: it is a form of a token that already trades, not a launch of its own.';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'Exchange product: its token already trades elsewhere, and an exchange is not a farmable launch.';
  if (VERSIONED.test(p.name)) return 'Versioned deployment: farm the protocol itself, not one numbered release of it.';
  return 'Set aside by the radar rule.';
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Median of numbers, or `fallback` when empty. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- fitting

/** Clamped 7-day growth, in per cent, as the hazard reads it. */
function clampedGrowth(p: SnapshotProtocol): number {
  return Math.min(150, Math.max(-50, finite(p.change_7d, 0)));
}

/**
 * The value fit: shrunk per-category multiples from the live protocols that
 * record a market cap, blended with the memo's external comps, plus the
 * validation the dashboard reports. Deterministic: folds follow sorted slug
 * order, and every fit is a closed-form median, never a random draw.
 */
export function fitValueModel(snapshot: Snapshot): ValueFit {
  const train = snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.category !== 'CEX' &&
      !VERSIONED.test(p.name) &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0,
  );
  const logRatio = (p: SnapshotProtocol): number =>
    Math.log10(Math.min(RATIO_CAP, Math.max(1e-3, (p.mcap_usd as number) / p.tvl_usd)));
  const globalMedian = median(train.map(logRatio), Math.log10(0.241));

  /** Snapshot multiple for one category from a training set: shrunk log-mean. */
  const snapshotMultiple = (rows: SnapshotProtocol[], category: string | null): number | null => {
    const vals = rows.filter((p) => (p.category ?? 'Other') === (category ?? 'Other')).map(logRatio);
    if (vals.length === 0) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.pow(10, (vals.length * mean + SHRINK_K * globalMedian) / (vals.length + SHRINK_K));
  };

  /** The multiple actually used for a category: blended, then clamped. */
  const blended = (rows: SnapshotProtocol[], category: string | null): number => {
    const s = snapshotMultiple(rows, category);
    const m = MEMO_MULTIPLES[category ?? ''];
    let mult: number;
    if (s !== null && m !== undefined) mult = Math.sqrt(s * m);
    else if (s !== null) mult = s;
    else if (m !== undefined) mult = m;
    else mult = Math.pow(10, globalMedian);
    return Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, mult));
  };

  // The CV validates the multiple itself, on market-cap scale: the FDV
  // uplift converts a market cap into a fully-diluted value and is not part
  // of predicting a market cap, so it stays out of these predictions.
  const predict = (rows: SnapshotProtocol[], p: SnapshotProtocol): number =>
    p.tvl_usd * blended(rows, p.category);
  const baselinePredict = (rows: SnapshotProtocol[], p: SnapshotProtocol): number => {
    const g = median(rows.map(logRatio), globalMedian);
    return p.tvl_usd * Math.pow(10, g);
  };
  const relErr = (pred: number, actual: number): number => Math.abs(actual - pred) / actual;

  // 10-fold CV, folds by sorted slug order.
  const slugs = [...train].map((p) => p.slug).sort();
  const foldOf = new Map(slugs.map((s, i) => [s, i % 10]));
  const errs: number[] = [];
  const baseErrs: number[] = [];
  for (let k = 0; k < 10; k++) {
    const tr = train.filter((p) => foldOf.get(p.slug) !== k);
    const te = train.filter((p) => foldOf.get(p.slug) === k);
    for (const p of te) {
      errs.push(relErr(predict(tr, p), p.mcap_usd as number));
      baseErrs.push(relErr(baselinePredict(tr, p), p.mcap_usd as number));
    }
  }

  // Older-to-newer: fit on the older half by listed_at, test on the newer.
  const dated = train.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : 1);
  const splitAt = dated[Math.floor(dated.length / 2)]?.listed_at ?? null;
  const older = dated.filter((p) => (p.listed_at as string) < (splitAt as string));
  const newer = dated.filter((p) => (p.listed_at as string) >= (splitAt as string));
  const newerErrs = newer.map((p) => relErr(predict(older, p), p.mcap_usd as number));
  const logPred = newer.map((p) => Math.log10(predict(older, p)));
  const logAct = newer.map((p) => Math.log10(p.mcap_usd as number));
  const meanAct = logAct.reduce((a, b) => a + b, 0) / Math.max(1, logAct.length);
  const ssRes = logPred.reduce((a, v, i) => a + (v - logAct[i]!) ** 2, 0);
  const ssTot = logAct.reduce((a, v) => a + (v - meanAct) ** 2, 0);
  const newerR2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const categories = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))].sort();
  const multiples: Record<string, number> = {};
  const snapshotMultiples: Record<string, number | null> = {};
  for (const c of categories) {
    multiples[c] = blended(train, c === 'Other' ? null : c);
    snapshotMultiples[c] = snapshotMultiple(train, c === 'Other' ? null : c);
  }
  return {
    n_train: train.length,
    global_median: Math.pow(10, globalMedian),
    multiples,
    snapshot_multiples: snapshotMultiples,
    cv_median_rel_err: median(errs, 0),
    cv_mean_rel_err: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length),
    cv_baseline_median_rel_err: median(baseErrs, 0),
    newer_median_rel_err: median(newerErrs, 0),
    newer_r2: round4(newerR2),
  };
}

/** One row's features for the hazard fit: age in years, log10 TVL centred at 1e8, clamped growth. */
interface HazardPoint {
  ageYears: number;
  logTvl: number;
  growth: number;
  token: number;
}

function hazardPoints(snapshot: Snapshot): HazardPoint[] {
  return snapshot.protocols
    .filter((p) => p.category !== 'CEX' && !VERSIONED.test(p.name))
    .map((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      return {
        ageYears: (age ?? 365) / 365,
        logTvl: Math.log10(Math.max(p.tvl_usd, 1)) - 8,
        growth: clampedGrowth(p) / 100,
        token: isPreToken(p) ? 0 : 1,
      };
    });
}

/** Negative log-likelihood of the decreasing-hazard model at `theta`. */
function hazardNll(points: HazardPoint[], theta: number[]): number {
  const [h0, k, bT, bG] = theta as [number, number, number, number];
  if (!(h0 > 0) || !(k > 0)) return 1e9;
  let nll = 0;
  for (const pt of points) {
    const h = (h0 / k) * (1 - Math.exp(-k * pt.ageYears)) * Math.exp(bT * pt.logTvl + bG * pt.growth);
    const pTok = Math.min(1 - 1e-9, Math.max(1e-9, 1 - Math.exp(-Math.min(50, Math.max(1e-9, h)))));
    nll -= pt.token * Math.log(pTok) + (1 - pt.token) * Math.log(1 - pTok);
  }
  return nll;
}

/** AUC of P(token by now) against the actual token record (tie-aware, by rank). */
function hazardAuc(points: HazardPoint[], theta: number[]): number {
  const [h0, k, bT, bG] = theta as [number, number, number, number];
  const scored = points.map((pt) => {
    const h = (h0 / k) * (1 - Math.exp(-k * pt.ageYears)) * Math.exp(bT * pt.logTvl + bG * pt.growth);
    return { s: 1 - Math.exp(-Math.min(50, Math.max(1e-9, h))), y: pt.token };
  });
  scored.sort((a, b) => a.s - b.s);
  let auc = 0;
  let neg = 0;
  let i = 0;
  const nPos = scored.filter((r) => r.y === 1).length;
  const nNeg = scored.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  while (i < scored.length) {
    let j = i;
    while (j < scored.length && scored[j]!.s === scored[i]!.s) j++;
    const groupPos = scored.slice(i, j).filter((r) => r.y === 1).length;
    const groupNeg = j - i - groupPos;
    // Each positive in this group outranks every negative below it, and half the negatives tied with it.
    auc += groupPos * (neg + groupNeg / 2);
    neg += groupNeg;
    i = j;
  }
  return auc / (nPos * nNeg);
}

/**
 * Fit the hazard by maximum likelihood: a coarse grid, then coordinate
 * descent with halving steps, a fixed number of rounds. Deterministic.
 */
export function fitHazard(snapshot: Snapshot, maxRounds = 300): HazardFit {
  const points = hazardPoints(snapshot);
  let best: number[] = [1, 1, 0, 0];
  let bestNll = Infinity;
  for (const h0 of [0.2, 0.5, 1.0, 2.0]) {
    for (const k of [0.3, 0.7, 1.5, 3.0]) {
      for (const bT of [-0.3, 0, 0.3]) {
        for (const bG of [-0.5, 0, 0.5]) {
          const v = hazardNll(points, [h0, k, bT, bG]);
          if (v < bestNll) {
            bestNll = v;
            best = [h0, k, bT, bG];
          }
        }
      }
    }
  }
  let step = [0.2, 0.2, 0.1, 0.1];
  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (let i = 0; i < 4; i++) {
      for (const s of [1, -1]) {
        const cand = [...best];
        cand[i] = cand[i]! + s * step[i]!;
        const v = hazardNll(points, cand);
        if (v < bestNll - 1e-9) {
          bestNll = v;
          best = cand;
          improved = true;
        }
      }
    }
    if (!improved) {
      step = step.map((x) => x / 2);
      if (Math.max(...step) < 1e-4) break;
    }
  }
  // Null: constant hazard, no modifiers (grid, modifiers fixed at 0).
  let nullBest = Infinity;
  for (const h0 of [0.2, 0.5, 1.0, 2.0]) {
    for (const k of [0.3, 0.7, 1.5, 3.0]) {
      const v = hazardNll(points, [h0, k, 0, 0]);
      if (v < nullBest) {
        nullBest = v;
      }
    }
  }
  // 10-fold CV AUC, folds by position in the protocols array (deterministic).
  const aucs: number[] = [];
  for (let f = 0; f < 10; f++) {
    const tr = points.filter((_, i) => i % 10 !== f);
    const te = points.filter((_, i) => i % 10 === f);
    if (tr.length === 0 || te.length === 0) continue;
    // Refit on the fold's training points only (same grid, fewer rounds).
    let b: number[] = [1, 1, 0, 0];
    let bn = Infinity;
    for (const h0 of [0.2, 0.5, 1.0, 2.0]) {
      for (const k of [0.3, 0.7, 1.5, 3.0]) {
        for (const bT of [-0.3, 0, 0.3]) {
          for (const bG of [-0.5, 0, 0.5]) {
            const v = hazardNll(tr, [h0, k, bT, bG]);
            if (v < bn) {
              bn = v;
              b = [h0, k, bT, bG];
            }
          }
        }
      }
    }
    let st = [0.2, 0.2, 0.1, 0.1];
    for (let round = 0; round < 60; round++) {
      let improved = false;
      for (let i = 0; i < 4; i++) {
        for (const s of [1, -1]) {
          const cand = [...b];
          cand[i] = cand[i]! + s * st[i]!;
          const v = hazardNll(tr, cand);
          if (v < bn - 1e-9) {
            bn = v;
            b = cand;
            improved = true;
          }
        }
      }
      if (!improved) {
        st = st.map((x) => x / 2);
        if (Math.max(...st) < 1e-4) break;
      }
    }
    aucs.push(hazardAuc(te, b));
  }
  return {
    n_fit: points.length,
    h0: round4(best[0]!),
    k: round4(best[1]!),
    bT: round4(best[2]!),
    bG: round4(best[3]!),
    nll: Math.round(bestNll * 10) / 10,
    nll_null: Math.round(nullBest * 10) / 10,
    auc: round4(hazardAuc(points, best)),
    cv_auc: round4(aucs.reduce((a, b) => a + b, 0) / Math.max(1, aucs.length)),
  };
}

/** Next-12-month launch odds for a still-tokenless protocol, from a fitted hazard. */
export function launchOdds(p: SnapshotProtocol, asOf: string, hazard: HazardFit): number {
  const age = ageDays(asOf, p.listed_at);
  const a = (age ?? 365) / 365;
  const ltv = Math.log10(Math.max(p.tvl_usd, 1)) - 8;
  const g = clampedGrowth(p) / 100;
  const h = (t: number): number =>
    (hazard.h0 / hazard.k) * (1 - Math.exp(-hazard.k * t)) * Math.exp(hazard.bT * ltv + hazard.bG * g);
  return Math.min(0.999, Math.max(0.001, 1 - Math.exp(-(h(a + 1) - h(a)))));
}

/** Fitted FDV if launched, from the value fit. */
export function fittedFdv(p: SnapshotProtocol, fit: ValueFit): number {
  const mult = fit.multiples[p.category ?? 'Other'] ?? fit.global_median;
  return p.tvl_usd * mult * FDV_UPLIFT;
}

/** The implied value of a pre-token protocol: fitted FDV times launch odds. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  fit: ModelFit,
): { implied: number; fdv: number; odds: number; multiple: number } {
  const multiple = fit.value.multiples[p.category ?? 'Other'] ?? fit.value.global_median;
  const fdv = p.tvl_usd * multiple * FDV_UPLIFT;
  const odds = launchOdds(p, asOf, fit.hazard);
  return { implied: Math.max(1, Math.round(fdv * odds)), fdv: Math.round(fdv), odds, multiple };
}

// ------------------------------------------------------------ farm plans

/** Gas tier of a chain: Ethereum L1 pays the most; everything else clears a simple transaction for a few cents. */
function gasOf(chains: string[]): { setup: string; weekly: string } {
  const main = chains[0] ?? 'Ethereum';
  if (main === 'Ethereum') return { setup: '~$0.30 of gas', weekly: '~$0.30 of gas a week' };
  if (main === 'Solana') return { setup: '~$0.01 of gas', weekly: '~$0.01 of gas a week' };
  return { setup: '~$0.05 of gas', weekly: '~$0.05 of gas a week' };
}

/** Deposit size by TVL tier: $100-250 of stablecoin, sized to the protocol's depth. */
function capitalOf(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 1_000_000_000) return '$250';
  if (p.tvl_usd >= 100_000_000) return '$150';
  return '$100';
}

/** How long to keep the position: young protocols get a long hold, old ones a short one. */
function holdMonthsOf(p: SnapshotProtocol, asOf: string): number {
  const age = ageDays(asOf, p.listed_at);
  if (age === null) return 6;
  if (age < 180) return 9;
  if (age < 365) return 6;
  return 3;
}

/** The main qualifying action for a category, and the second action that proves a real user. */
function categoryActions(p: SnapshotProtocol): { main: string; second: string } {
  const cat = p.category ?? '';
  const cap = capitalOf(p);
  const mainChain = p.chains[0] ?? 'Ethereum';
  const vault = (n: string): string =>
    `Deposit ${cap} of stablecoin into the protocol's ${n} on ${mainChain}, staying in the position; this is the transaction the points programme, if any, records.`;
  switch (cat) {
    case 'Lending':
    case 'CDP':
    case 'Collateral Markets':
    case 'Collateral Management':
    case 'Uncollateralized Lending':
      return {
        main: `Supply ${cap} of stablecoin to the lending market on ${mainChain}; keep the supply in place so the position earns and is recorded.`,
        second: 'Borrow $10 of stablecoin against the supply and repay it a week later, so the account shows two kinds of activity.',
      };
    case 'Dexs':
      return {
        main: `Provide ${cap} of a stablecoin pair to the exchange's liquidity pool on ${mainChain} for the holding period; leave it in place so the position accrues fees.`,
        second: 'Swap $25 of stablecoin for the other pool token and back, so the account shows a trading transaction as well.',
      };
    case 'Yield':
    case 'Yield Aggregator':
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return {
        main: vault('vault'),
        second: 'Deposit a further $50 into a second vault or strategy, so the account shows more than one allocation.',
      };
    case 'RWA':
      return {
        main: `Buy ${cap} of the protocol's yield-bearing asset on ${mainChain} and hold it; read the redemption terms on the protocol's own page before you buy.`,
        second: 'Withdraw $25 to the protocol\'s redemption flow, then re-enter, so the account shows a full cycle.',
      };
    case 'Derivatives':
    case 'Options':
    case 'Interest Rate Derivatives':
      return {
        main: `Open a $50 position on the perpetuals or derivatives venue on ${mainChain} with low leverage (2x or less), and close it after a week.`,
        second: 'Place one small limit order, so the account shows a resting order as well as a market trade.',
      };
    case 'Basis Trading':
      return {
        main: vault('basis vault'),
        second: 'Check the funding rate on the protocol\'s own page each week; note whether the rate is still positive before topping up.',
      };
    case 'Stablecoin Issuer':
    case 'Stablecoin Wrapper':
    case 'Dual-Token Stablecoin':
    case 'Reserve Currency':
      return {
        main: `Mint ${cap} of the protocol's stablecoin from stablecoin collateral on ${mainChain}, and hold it for the holding period.`,
        second: 'Redeem $25 of it back to collateral, then re-mint, so the account shows a full mint-redeem cycle.',
      };
    case 'Restaking':
    case 'Liquid Restaking':
    case 'Liquid Staking':
    case 'Staking Pool':
      return {
        main: `Stake ${cap} of the underlying asset through the protocol on ${mainChain} and hold the receipt token; never stake through a link anyone sends you.`,
        second: 'Delegate or restake the receipt token once, so the account shows the second layer of the position.',
      };
    case 'Chain':
      return {
        main: `Delegate ${cap} of the chain's staking asset through the chain's own staking interface and keep the delegation in place.`,
        second: 'Vote on one governance proposal, so the account shows participation as well as stake.',
      };
    case 'Prediction Market':
      return {
        main: `Fund ${cap} of stablecoin into the prediction market on ${mainChain} and take a position on one market; keep the position until it resolves.`,
        second: 'Provide $25 of liquidity to the market, so the account shows both trading and liquidity.',
      };
    case 'Payments':
      return {
        main: `Open a payment channel with ${cap} of stablecoin on ${mainChain} and route one payment through it.`,
        second: 'Send a second small payment to a different counterparty, so the channel shows more than one route.',
      };
    case 'Insurance':
      return {
        main: `Buy ${cap} of cover from the protocol on ${mainChain} for the holding period; read the exclusions on the protocol's own page before you pay.`,
        second: 'File one test claim on a covered event only if it genuinely occurs; never file a claim for an event that did not happen.',
      };
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return {
        main: `Bridge ${cap} of stablecoin from one chain the protocol supports to another, then bridge $25 back a week later.`,
        second: 'Bridge a second asset, so the account shows more than one route.',
      };
    case 'Farm':
      return {
        main: vault('farm'),
        second: 'Harvest the rewards once, so the account shows a claim as well as a deposit.',
      };
    case 'Governance Incentives':
      return {
        main: vault('incentives vault'),
        second: 'Vote on one governance proposal, so the account shows participation as well as a deposit.',
      };
    case 'CeDeFi':
    case 'Indexes':
    case 'Liquidity Manager':
    case 'Leveraged Farming':
    case 'Crypto Card Issuer':
    case 'OTC Marketplace':
    case 'DOR':
      return {
        main: vault('vault'),
        second: 'Make a second small deposit a week later, so the account shows sustained activity.',
      };
    default:
      return {
        main: vault('vault'),
        second: 'Make a second small deposit a week later, so the account shows sustained activity.',
      };
  }
}

/**
 * Seven farm steps for a pre-token protocol: wallet, deposit, a second
 * action, weekly habit, hold, monthly check, exit plan. Every step carries
 * its gas cost (by chain tier) and its time.
 */
export function farmSteps(p: SnapshotProtocol, asOf: string): FarmStep[] {
  const gas = gasOf(p.chains);
  const cap = capitalOf(p);
  const hold = holdMonthsOf(p, asOf);
  const a = categoryActions(p);
  return [
    { text: `Create a fresh wallet for this farm and write its seed phrase on paper, offline. Never paste the seed anywhere, and never use a wallet that holds your main funds.`, cost: 'No gas to create a wallet', time: '5 minutes' },
    { text: a.main, cost: gas.setup, time: '15 minutes to set up' },
    { text: a.second, cost: gas.setup, time: '10 minutes' },
    { text: `Each week, make one qualifying transaction on ${p.chains[0] ?? 'the chain'} — a small deposit, swap or vote — so the account stays active. Skip a week if gas spikes above $1; the points programme, if any, rewards months of activity, not daily noise.`, cost: gas.weekly, time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} months. Points programmes typically run 6 to 12 months; leaving early usually means leaving empty-handed. The ${cap} stays in the position the whole time, so the real cost is the yield it would earn elsewhere, not the gas.`, cost: 'The position itself, not a fee', time: `${hold} months` },
    { text: `Once a month, open the protocol's own points page and check the balance. Claim nothing from any link anyone sends you; only the protocol's own page can show it. If new inflows cut your share of points per dollar by more than half, stop topping up.`, cost: 'No fee to check', time: '10 minutes a month' },
    { text: `Write down the wallet, the dates and the transaction hashes, and unwind when the protocol launches a token, pauses its points programme, or loses half its TVL in a month. Never pay anyone to claim on your behalf.`, cost: 'Nothing', time: '5 minutes' },
  ];
}

/**
 * Five positioning steps for a live-token protocol: no airdrop to farm,
 * a valuation check against the model's own numbers, the position, the
 * risk, and the review cadence.
 */
export function liveSteps(p: SnapshotProtocol, asOf: string, fit: ValueFit): FarmStep[] {
  const age = ageDays(asOf, p.listed_at);
  const mult = fit.multiples[p.category ?? 'Other'] ?? fit.global_median;
  const fitted = p.tvl_usd * mult * FDV_UPLIFT;
  const valuation =
    p.mcap_usd !== null
      ? `Its market cap is $${Math.round(p.mcap_usd).toLocaleString('en-US')} against $${Math.round(p.tvl_usd).toLocaleString('en-US')} of TVL, ${((p.mcap_usd / p.tvl_usd) * 100).toFixed(1)}% of TVL; the fitted category multiple is ${mult.toFixed(2)}x, so the model prices the protocol at about $${Math.round(fitted).toLocaleString('en-US')} fully diluted.`
      : `Its market cap is unreported, so the model's fitted value is $${Math.round(fitted).toLocaleString('en-US')} fully diluted at the fitted category multiple of ${mult.toFixed(2)}x.`;
  return [
    { text: `This protocol's token already trades — there is no airdrop to farm here. Judge it as a position, not a free option.`, cost: 'Nothing', time: '5 minutes' },
    { text: `${valuation} Compare that with the other ${p.category ?? 'category'} protocols on this board before deciding whether it is expensive or cheap; a single multiple never settles the question.`, cost: 'Nothing', time: '20 minutes' },
    { text: `If you take a position, size it small: no more than 2% of a portfolio in any one protocol, and use the protocol's own staking or vault rather than leverage.`, cost: 'Gas only', time: '15 minutes' },
    { text: `Know the risk before you enter: check the unlock schedule on the protocol's own page, and remember that a protocol ${age !== null ? `running ${Math.floor(age / 365)} years` : 'running this long'} can still fall 30% in a month in a down market.`, cost: 'Nothing', time: '10 minutes' },
    { text: `Review the position once a month against this board's updated numbers; sell the position if its market cap rises above twice the model's fitted value for two reviews in a row.`, cost: 'Nothing', time: '10 minutes a month' },
  ];
}

/** Verdict for a pre-token protocol, from its implied value. */
export function verdictOf(implied: number): 'FARM' | 'THIN' | 'SKIP' {
  if (implied >= FARM_MIN_USD) return 'FARM';
  if (implied >= THIN_MIN_USD) return 'THIN';
  return 'SKIP';
}

// ------------------------------------------------------------ board build

/** A row's model explanation, as the dashboard's detail view shows it. */
function explainPre(p: SnapshotProtocol, asOf: string, fit: ModelFit): {
  implied: number;
  fdv: number;
  odds: number;
  multiple: number;
  steps: FarmStep[];
} {
  const v = impliedValue(p, asOf, fit);
  const steps = farmSteps(p, asOf);
  return { implied: v.implied, fdv: v.fdv, odds: v.odds, multiple: v.multiple, steps };
}

/** Rank the board and assemble the dashboard data, fitting the model from the snapshot on every run. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = { value: fitValueModel(snapshot), hazard: fitHazard(snapshot) };
  const rows: BoardRow[] = [];
  const setAside: SetAsideRow[] = [];
  for (const p of snapshot.protocols) {
    const reason = setAsideReason(p);
    if (reason !== null) {
      setAside.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        token_status: isPreToken(p) ? 'pre-token' : 'live',
        reason,
      });
      continue;
    }
    const age = ageDays(snapshot.as_of, p.listed_at);
    const growth = clampedGrowth(p);
    if (isPreToken(p)) {
      const e = explainPre(p, snapshot.as_of, fit);
      const verdict = verdictOf(e.implied);
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: null,
        listed_at: p.listed_at,
        gecko_id: null,
        symbol: null,
        token_status: 'pre-token',
        value_basis: 'implied',
        age_days: age,
        implied_value_usd: e.implied,
        fitted_fdv_usd: e.fdv,
        launch_odds: round4(e.odds),
        multiple: e.multiple,
        verdict,
        model: { multiple: round4(e.multiple), fdv_usd: e.fdv, launch_odds: round4(e.odds), growth_pct: growth, age_days: age },
        farm_steps: e.steps.map((s) => `${s.text} Cost: ${s.cost}. Time: ${s.time}.`),
      });
    } else {
      const steps = liveSteps(p, snapshot.as_of, fit.value);
      const multiple = fit.value.multiples[p.category ?? 'Other'] ?? fit.value.global_median;
      const fitted = fittedFdv(p, fit.value);
      let value: number;
      let basis: 'market-cap' | 'fitted';
      if (p.mcap_usd !== null && p.mcap_usd > 0) {
        value = Math.round(p.mcap_usd);
        basis = 'market-cap';
      } else {
        value = Math.round(fitted);
        basis = 'fitted';
      }
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        token_status: 'live',
        value_basis: basis,
        age_days: age,
        implied_value_usd: value,
        fitted_fdv_usd: basis === 'fitted' ? Math.round(fitted) : null,
        launch_odds: null,
        multiple: basis === 'fitted' ? round4(multiple) : null,
        verdict: 'POSITION',
        model: { multiple: basis === 'fitted' ? round4(multiple) : null, fdv_usd: basis === 'fitted' ? Math.round(fitted) : null, launch_odds: null, growth_pct: growth, age_days: age },
        farm_steps: steps.map((s) => `${s.text} Cost: ${s.cost}. Time: ${s.time}.`),
      });
    }
  }
  // Rank by value, ties by slug so the order is stable run to run.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i + 1));
  const pre = rows.filter((r) => r.token_status === 'pre-token');
  const live = rows.filter((r) => r.token_status === 'live');
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    pre_size: pre.length,
    live_size: live.length,
    set_aside_size: setAside.length,
    farm_count: pre.filter((r) => r.verdict === 'FARM').length,
    thin_count: pre.filter((r) => r.verdict === 'THIN').length,
    skip_count: pre.filter((r) => r.verdict === 'SKIP').length,
    fit,
    rows: rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      token_status: r.token_status,
      value_basis: r.value_basis,
      implied_value_usd: r.implied_value_usd,
      fitted_fdv_usd: r.fitted_fdv_usd,
      launch_odds: r.launch_odds,
      multiple: r.multiple,
      verdict: r.verdict,
      farm_steps: r.farm_steps,
    })),
    set_aside: setAside.sort((a, b) => b.tvl_usd - a.tvl_usd),
  };
  return { board: rows, radar };
}

/** Validate the snapshot shape; throw `SnapshotError` on the first bad field. */
export function parseSnapshot(raw: unknown): Snapshot {
  if (typeof raw !== 'object' || raw === null) throw new SnapshotError('Snapshot must be an object');
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('Snapshot.protocols must be an array');
  if (typeof doc.as_of !== 'string') throw new SnapshotError('Snapshot.as_of must be a string');
  if (typeof doc.source !== 'string') throw new SnapshotError('Snapshot.source must be a string');
  if (typeof doc.floor_usd !== 'number' || !Number.isFinite(doc.floor_usd)) {
    throw new SnapshotError('Snapshot.floor_usd must be a number');
  }
  if (!Array.isArray(doc.watchlist) || !doc.watchlist.every((w) => typeof w === 'string')) {
    throw new SnapshotError('Snapshot.watchlist must be an array of strings');
  }
  const protocols = doc.protocols.map((rawP, idx) => {
    const p = rawP as Record<string, unknown>;
    const slug = p.slug;
    const name = p.name;
    if (typeof slug !== 'string' || slug.length === 0) throw new SnapshotError(`protocols[${idx}].slug must be a non-empty string`);
    if (typeof name !== 'string' || name.length === 0) throw new SnapshotError(`protocols[${idx}].name must be a non-empty string`);
    if (p.category !== null && typeof p.category !== 'string') throw new SnapshotError(`protocols[${idx}].category must be a string or null`);
    if (!Array.isArray(p.chains) || !p.chains.every((c) => typeof c === 'string')) {
      throw new SnapshotError(`protocols[${idx}].chains must be an array of strings`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`protocols[${idx}].tvl_usd must be a non-negative number`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) {
      throw new SnapshotError(`protocols[${idx}].change_7d must be a number or null`);
    }
    if (p.mcap_usd !== null && (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd) || p.mcap_usd < -1)) {
      throw new SnapshotError(`protocols[${idx}].mcap_usd must be a non-negative number, -1 (unreported) or null`);
    }
    if (p.listed_at !== null && typeof p.listed_at !== 'string') throw new SnapshotError(`protocols[${idx}].listed_at must be a string or null`);
    if (p.gecko_id !== null && typeof p.gecko_id !== 'string') throw new SnapshotError(`protocols[${idx}].gecko_id must be a string or null`);
    if (p.symbol !== null && typeof p.symbol !== 'string') throw new SnapshotError(`protocols[${idx}].symbol must be a string or null`);
    return {
      slug,
      name,
      category: (p.category ?? null) as string | null,
      chains: p.chains as string[],
      tvl_usd: p.tvl_usd,
      change_7d: (p.change_7d ?? null) as number | null,
      // DefiLlama writes -1 where a market cap is unreported; treat it as null.
      mcap_usd: p.mcap_usd === -1 ? null : (p.mcap_usd ?? null) as number | null,
      listed_at: (p.listed_at ?? null) as string | null,
      gecko_id: (p.gecko_id ?? null) as string | null,
      symbol: (p.symbol ?? null) as string | null,
    } satisfies SnapshotProtocol;
  });
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

/** The board's own gate checks: board shape, coverage, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `Board must have 100-4000 rows, got ${board.length}`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  const snap = bySlug(snapshot.protocols);
  for (const row of board) {
    if (!snap.has(row.slug)) return `Board row ${row.slug} is not in the snapshot`;
  }
  const missingWatchlist = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missingWatchlist.length > 0) {
    return `Board misses ${missingWatchlist.length} watchlist protocols: ${missingWatchlist.slice(0, 10).join(', ')}`;
  }
  const seen = new Set<number>();
  for (const row of board) {
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > board.length) {
      return `Bad rank ${row.rank} for ${row.slug}`;
    }
    if (seen.has(row.rank)) return `Duplicate rank ${row.rank}`;
    seen.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `implied_value_usd must be a positive integer for ${row.slug}, got ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm_steps must have 3-12 entries for ${row.slug}, got ${row.farm_steps.length}`;
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600) {
        return `farm step for ${row.slug} must be 20-600 chars, got ${step.length}`;
      }
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `Board not sorted: ${board[i]!.slug} (${board[i]!.implied_value_usd}) after ${board[i - 1]!.slug} (${board[i - 1]!.implied_value_usd})`;
    }
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (values.size < 2) return 'All implied values are equal';
  return null;
}

/** The dashboard's data file: a guarded script that sets `window.RADAR`. */
export function dataScript(radar: RadarData): string {
  const rowsJson = JSON.stringify(radar.rows);
  const setAsideJson = JSON.stringify(radar.set_aside);
  const fitJson = JSON.stringify(radar.fit);
  const safe = (json: string): string => json.replaceAll('<', '\\u003c').replaceAll('&', '\\u0026');
  return `window.RADAR = {
  as_of: ${JSON.stringify(radar.as_of)},
  source: ${JSON.stringify(radar.source)},
  floor_usd: ${radar.floor_usd},
  model_version: ${JSON.stringify(radar.model_version)},
  watchlist_size: ${radar.watchlist_size},
  board_size: ${radar.board_size},
  pre_size: ${radar.pre_size},
  live_size: ${radar.live_size},
  set_aside_size: ${radar.set_aside_size},
  farm_count: ${radar.farm_count},
  thin_count: ${radar.thin_count},
  skip_count: ${radar.skip_count},
  fit: ${safe(fitJson)},
  rows: ${safe(rowsJson)},
  set_aside: ${safe(setAsideJson)}
};`;
}
