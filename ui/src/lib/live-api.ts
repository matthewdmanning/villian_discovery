import type { LibraryApi } from "./api.ts";

/** Use this function to call the local live server; a failed call throws the server's error message. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Request failed: ${path}`);
  return result;
}

/** Use this function to explain that a feature has no live server route yet. */
async function notLive(): Promise<never> {
  throw new Error("Not available in live mode yet");
}

/** The UI's API over the local live server (`npm run live`); sync reads both apps and never writes. */
export const liveApi: LibraryApi = {
  demo: false,
  status: () => call("GET", "status"),
  login: () => call("POST", "login"),
  cards: () => call("GET", "cards"),
  search: notLive,
  run: notLive,
  previewSync: (options) => call("POST", "sync/preview", options ?? {}),
  applySync: (planId, approvals) => call("POST", "sync/apply", { planId, approvals }),
  getSyncSettings: () => call("GET", "sync/settings"),
  saveSyncSettings: (input) => call("PUT", "sync/settings", input),
};
