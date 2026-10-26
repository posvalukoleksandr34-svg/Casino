/** Exact binomial coefficient C(n, k) as a BigInt. */
export function binomial(n: number, k: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) throw new RangeError('binomial arguments must be non-negative integers');
  if (k > n) return 0n;
  const kk = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= kk; i += 1) {
    result = (result * BigInt(n - kk + i)) / BigInt(i);
  }
  return result;
}
