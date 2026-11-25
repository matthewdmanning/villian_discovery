import type { FableGet } from "../../src/discovery/export-lists.js";
import { HttpError } from "../../src/errors.js";
import { fetchAllPages, type Page } from "../../src/pagination.js";
import type { FablePost } from "../../src/sync-adapters.js";

const SITE = "https://fable.co";
export const FABLE_SIGN_IN_URL = `${SITE}/signin?next=%2Flibrary`;

/** Use this function to build a `FableGet` over the signed-in Chrome session's fable.co cookies; a non-2xx status throws `HttpError`, so 401 and 403 mean "not signed in". */
export function createFableGet(request: typeof fetch = fetch): FableGet {
  return async <T>(path: string, query: Record<string, string | number>) => {
    const url = new URL(path, SITE);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await request(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok)
      throw new HttpError(
        `fable.co returned ${response.status} for ${url.pathname}`,
        response.status,
        url.pathname,
        undefined,
      );
    return (await response.json()) as T;
  };
}

/** Use this function to build a `FablePost` over the signed-in Chrome session's fable.co cookies; a non-2xx status throws `HttpError`. */
export function createFablePost(request: typeof fetch = fetch): FablePost {
  return async <T>(path: string, body: unknown) => {
    const url = new URL(path, SITE);
    const response = await request(url, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new HttpError(
        `fable.co returned ${response.status} for ${url.pathname}`,
        response.status,
        url.pathname,
        undefined,
      );
    return (await response.json()) as T;
  };
}

/** Use this function to check that the Chrome profile is signed in to Fable; only an auth error reads as signed out. */
export async function isFableSignedIn(get: FableGet = createFableGet()): Promise<boolean> {
  try {
    await fetchAllPages({ limit: 1, offset: 0, media_type: "" }, (query) =>
      get<Page<unknown>>("/api/me/book-lists", query),
    );
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.isAuthError) return false;
    throw error;
  }
}
