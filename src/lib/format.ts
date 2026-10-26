/** Published RTP as text; simulation estimates are marked with “≈” so they are never read as exact values. */
export function rtpText(t: { rtp: number; method: string }, digits = 2): string {
  return `${t.method === 'exact' ? '' : '≈'}${(t.rtp * 100).toFixed(digits)}%`;
}
