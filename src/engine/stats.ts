/**
 * Small statistics toolkit shared by analytics, simulations and tests.
 * Pure functions, no dependencies.
 */

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be in (0, 1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const at = (arr: number[], i: number) => arr[i] as number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((at(c, 0) * q + at(c, 1)) * q + at(c, 2)) * q + at(c, 3)) * q + at(c, 4)) * q + at(c, 5)) /
      ((((at(d, 0) * q + at(d, 1)) * q + at(d, 2)) * q + at(d, 3)) * q + 1);
  }
  if (p > 1 - pLow) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((at(a, 0) * r + at(a, 1)) * r + at(a, 2)) * r + at(a, 3)) * r + at(a, 4)) * r + at(a, 5)) * q) /
    (((((at(b, 0) * r + at(b, 1)) * r + at(b, 2)) * r + at(b, 3)) * r + at(b, 4)) * r + 1);
}

/** Standard normal CDF via the complementary error function (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/** Two-sided p-value of a z statistic. */
export function twoSidedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Chi-square critical value (upper tail α) via the Wilson–Hilferty approximation. */
export function chiSquareCritical(df: number, alpha: number): number {
  const z = normalQuantile(1 - alpha);
  const k = df;
  return k * (1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k))) ** 3;
}

/** Pearson chi-square statistic for observed counts vs expected probabilities. */
export function chiSquareStatistic(observed: readonly number[], expectedP: readonly number[]): number {
  const n = observed.reduce((a, b) => a + b, 0);
  let chi = 0;
  observed.forEach((o, i) => {
    const e = n * (expectedP[i] as number);
    chi += ((o - e) * (o - e)) / e;
  });
  return chi;
}

/** Welford running mean/variance accumulator. */
export class RunningStats {
  n = 0;
  mean = 0;
  private m2 = 0;
  min = Infinity;
  max = -Infinity;

  push(x: number): void {
    this.n += 1;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (x - this.mean);
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }

  get variance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }

  get stdDev(): number {
    return Math.sqrt(this.variance);
  }

  get standardError(): number {
    return this.n > 0 ? this.stdDev / Math.sqrt(this.n) : Infinity;
  }

  /** Normal-approximation confidence interval for the mean. */
  ci(confidence = 0.95): [number, number] {
    const z = normalQuantile(1 - (1 - confidence) / 2);
    return [this.mean - z * this.standardError, this.mean + z * this.standardError];
  }
}

/**
 * z-score of realised payouts against theory: (actual − expected) / sqrt(Σ variance).
 * Positive values mean players won more than expected.
 */
export function payoutZScore(actualPayout: number, expectedPayout: number, payoutVariance: number): number | null {
  if (!(payoutVariance > 0)) return null;
  return (actualPayout - expectedPayout) / Math.sqrt(payoutVariance);
}
