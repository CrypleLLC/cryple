import type { ApiResponse, PageInfo } from './client';

export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_PAGE_LIMIT = 50;

export interface PageRequest {
  limit?: number;
  cursor?: string;
}

export type PageFetcher<T> = (page: PageRequest) => Promise<ApiResponse<T[]>>;

export function assertValidLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}, got ${limit}`);
  }
  return limit;
}

export async function collectPages<T>(
  fetchPage: PageFetcher<T>,
  options: { limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const { limit, maxPages = 1000 } = options;
  if (limit !== undefined) {
    assertValidLimit(limit);
  }

  const items: T[] = [];
  let cursor: string | undefined;

  for (let pages = 0; pages < maxPages; pages++) {
    const response = await fetchPage({ limit, cursor });
    items.push(...(response.data ?? []));

    const page: PageInfo | undefined = response.page;
    if (page === undefined || page.has_more !== true) {
      return items;
    }
    if (page.next_cursor === undefined) {
      return items;
    }
    cursor = page.next_cursor;
  }

  throw new Error(`pagination exceeded ${maxPages} pages — refusing to loop further`);
}
