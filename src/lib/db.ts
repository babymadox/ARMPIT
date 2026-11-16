/**
 * Supabase caps every query at 1000 rows (the project's max-rows setting) no matter what .limit() says, and returns the
 * first 1000 without any error. Anything that must see ALL rows pages through them with this helper.
 * `page(from, to)` must order by a unique column so pages do not overlap or skip.
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 1000, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
  throw new Error(`more than ${max} rows: refusing to load them all`);
}
