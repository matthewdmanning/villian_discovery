/** Use this file for paging helpers that need no Node or browser APIs, so the extension can bundle them. */
export interface Page<T> {
  next: string | null;
  results: T[];
}
export type Query = Record<string, string | number>;

/**
 * All results of a DRF-paginated endpoint: follows `next` until null.
 * fable.co's `next` links point at api.fable.co, which needs a token, so only their
 * query (`limit`, `offset`, …) is taken and sent back to the same fable.co path.
 */
export async function fetchAllPages<T>(first: Query, get: (query: Query) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  for (let query: Query | undefined = first; query; ) {
    const page: Page<T> = await get(query);
    all.push(...page.results);
    // An empty page ends the loop too, so a bad `next` cannot loop forever.
    query = page.next && page.results.length ? Object.fromEntries(new URL(page.next).searchParams) : undefined;
  }
  return all;
}
