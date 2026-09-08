/**
 * Parsers for environment variables. Everything in `process.env` is a string or
 * `undefined`, and every config factory under `src/config/` needs the same two
 * conversions — so they live here and the factories stay pure declaration.
 */

/**
 * A positive integer, or `fallback` when the variable is unset, not a number,
 * or zero/negative. Every numeric knob we have (bitrates, participant caps,
 * TTLs) is meaningless at `<= 0`, so that case is a misconfiguration and takes
 * the default rather than propagating.
 */
export const envInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * A comma-separated variable as a trimmed list. An unset or empty variable
 * yields `[]`, so callers can branch on `.length` instead of on `undefined`.
 */
export const envList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
