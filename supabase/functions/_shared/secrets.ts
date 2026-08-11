/** Constant-time string compare for webhook/cron secrets. */
export function secretsEqual(provided: string | null, expected: string | null): boolean {
  if (provided == null || expected == null) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}
