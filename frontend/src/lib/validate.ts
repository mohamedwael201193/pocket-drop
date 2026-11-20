// Plain-language reasons for a bad amount, one per kind of mistake (B-13). Range checks (minimum, maximum, balance) come after.
export function amountFormatProblem(raw: string, example = '0.3'): string | null {
  const s = raw.trim();
  if (s === '') return `Enter an amount, for example ${example}.`;
  if (s.startsWith('-')) return 'The amount cannot be negative.';
  if (/e/i.test(s)) return `Write the amount as plain digits, like ${example}.`;
  if (s.includes(',')) return `Use a dot for decimals, like ${example}.`;
  if ((s.match(/\./g) ?? []).length > 1) return 'Use only one dot.';
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return `Use digits only, like ${example}.`;
  const [int = '', dec = ''] = s.split('.');
  if (dec.length > 6) return 'Use at most 6 decimals.';
  if (int.replace(/^0+/, '').length > 3) return 'That is far more than any limit here.';
  return null;
}

/** Whole number in a range, for counts such as pool slots. */
export function countProblem(raw: string, min: number, max: number, what: string): string | null {
  const s = raw.trim();
  if (s === '') return `Enter the number of ${what}.`;
  if (!/^\d+$/.test(s)) return `${what[0].toUpperCase()}${what.slice(1)} must be a whole number.`;
  const n = Number(s);
  if (n < min || n > max) return `Choose ${min} to ${max} ${what}.`;
  return null;
}
