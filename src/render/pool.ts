export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Run `fn` over `items` with at most `concurrency` active at a time. Preserves input order in the
 * result array and NEVER rejects: a task that throws becomes `{ok:false, error}` in its slot, so one
 * bad item can't abort the batch. `concurrency` is clamped to ≥ 1.
 */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const results: PoolResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
