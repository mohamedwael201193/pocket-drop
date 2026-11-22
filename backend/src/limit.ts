/** Run `fn` over `items` with at most `n` calls in flight; results keep the input order. The Diana RPC answers parallel
 *  calls far faster than serial ones or JSON-RPC batches (measured: 16 getLogs serial 16.9 s, batched 6.4 s, parallel 1.9 s). */
export async function mapLimited<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/** Split [from, to] into ranges of `size` blocks. */
export function ranges(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += size) out.push([f, f + size - 1n > to ? to : f + size - 1n]);
  return out;
}
