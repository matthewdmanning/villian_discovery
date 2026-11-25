import { LibbyClient } from "../../src/libby-client.ts";
import { identityFromLibbyStorage, LIBBY_IDENTITY_KEY } from "../../src/libby-storage.ts";
import { silentLogger } from "../../src/logger.ts";

export const LIBBY_URL = "https://libbyapp.com/";
const TOKEN_KEY = "libbyIdentity";
const http = {
  timeoutMs: 30_000,
  retries: 2,
  retryBaseMs: 500,
  userAgent: "libby-shelf-extension",
  logger: silentLogger,
};

let problem = "";

/** Use this function to read why the last `libbyClient` call found no signed-in identity. */
export const libbyProblem = () => problem;

/** Use this function to read the identity tokens that open libbyapp.com tabs hold in `localStorage`. */
async function tabTokens(): Promise<string[]> {
  const tabs = await chrome.tabs.query({ url: `${LIBBY_URL}*` });
  if (!tabs.length) problem = "No libbyapp.com tab is open";
  const reads = tabs.flatMap((tab) =>
    tab.id === undefined
      ? []
      : [
          chrome.scripting
            .executeScript({
              target: { tabId: tab.id },
              func: (key) => localStorage.getItem(key),
              args: [LIBBY_IDENTITY_KEY],
            })
            .then(([frame]) => identityFromLibbyStorage(frame?.result as string | null | undefined))
            .catch((error: unknown) => {
              problem = `Could not read the Libby tab: ${String(error)}`;
              return undefined;
            }),
        ],
  );
  const tokens = (await Promise.all(reads)).filter((token): token is string => !!token);
  if (tabs.length && !tokens.length && !problem) problem = "The Libby tab holds no sign-in token";
  return tokens;
}

/** Use this function to get a Libby client for the first stored or open-tab identity that has cards; Libby's anonymous identity has none, so it reads as signed out. Returns undefined when no identity works, and `libbyProblem` says why. */
export async function libbyClient(): Promise<LibbyClient | undefined> {
  problem = "";
  const stored = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY] as string | undefined;
  for (const identityToken of new Set([...(stored ? [stored] : []), ...(await tabTokens())])) {
    const client = new LibbyClient({ ...http, identityToken });
    const state = await client.sync().catch((error: unknown) => {
      problem = `Libby refused the token: ${String(error)}`;
      return undefined;
    });
    if (state && !state.cards?.length) problem = "This Libby identity has no library cards";
    if (!state?.cards?.length) continue;
    // The token lives in session storage only: it is gone when Chrome closes.
    await chrome.storage.session.set({ [TOKEN_KEY]: identityToken });
    return client;
  }
  return undefined;
}
