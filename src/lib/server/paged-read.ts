// Reading every row of a query, whatever the API's row cap.
//
// The database API returns at most a fixed number of rows per request (Supabase's "max rows",
// 1,000 by default) and gives no sign that more exist, so a single unpaged read silently
// truncates. This reads page after page — continuing from the rows actually received, so a
// response capped below the size asked for loses nothing — and stops only on an empty page.
//
// The query must be ordered by a unique key, or pages can overlap or skip.

export const READ_PAGE_SIZE = 1000;

/** A page failed. Nothing read before it is returned: a caller never gets partial rows. */
export class PagedReadError extends Error {
  constructor(readonly code: string | undefined) {
    super("PAGED_READ_FAILED");
    this.name = "PagedReadError";
  }
}

export interface PageResult {
  data: unknown;
  error: { code?: string } | null;
}

/**
 * Every row of the query `readPage` builds for the inclusive row window [from, to].
 * Throws PagedReadError if any page fails.
 */
export async function readAllRows<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult>,
  pageSize: number = READ_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new PagedReadError(error.code);
    const page = (Array.isArray(data) ? data : []) as T[];
    if (page.length === 0) return rows;
    rows.push(...page);
    from += page.length;
  }
}
