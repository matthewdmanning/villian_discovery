import type { LibraryApi } from "./api.ts";

// The launcher restarts a stopped server within seconds; the page waits for it instead of failing.
const SERVER_RESTART_WAIT_MS = 60_000;

/**
 * Use this function to call the local live server; a failed call throws the server's error message. When the
 * server does not answer, a call that is safe to repeat waits for the restarted server and sends again. Borrow
 * and apply calls are never sent twice.
 */
export async function call<T>(method: string, path: string, body?: unknown, repeatable = true): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  let response: Response;
  for (const deadline = Date.now() + SERVER_RESTART_WAIT_MS; ; await new Promise((r) => setTimeout(r, 2_000))) {
    try {
      response = await fetch(`/api/${path}`, init);
      break;
    } catch (error) {
      if (!repeatable || Date.now() > deadline) throw error;
    }
  }
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Request failed: ${path}`);
  return result;
}

/** The UI's API over the local live server (`npm run live`); sync reads both apps and never writes. */
export const liveApi: LibraryApi = {
  demo: false,
  cards: () => call("GET", "cards"),
  shelf: () => call("GET", "shelf"),
  tags: () => call("GET", "tags"),
  lists: () => call("GET", "lists"),
  pastCheckouts: () => call("GET", "past-checkouts"),
  listAvailability: (titleId) => call("POST", "lists/availability", { titleId }),
  lookupIsbn: (isbn) => call("POST", "isbn", { isbn }),
  search: (book, config) => call("POST", "search", { book, config }),
  run: (books, config) => call("POST", "run", { books, config }, false),
  previewSync: (options) => call("POST", "sync/preview", options ?? {}),
  applySync: (planId, approvals) => call("POST", "sync/apply", { planId, approvals }, false),
  getSyncSettings: () => call("GET", "sync/settings"),
  saveSyncSettings: (input) => call("PUT", "sync/settings", input),
};
