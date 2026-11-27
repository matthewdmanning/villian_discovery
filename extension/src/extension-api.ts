import type { Config } from "../../src/config.ts";
import type { CatalogReader } from "../../src/libby-audiobooks.ts";
import { listLibraryAvailability } from "../../src/libby-list-availability.ts";
import { readLists } from "../../src/libby-lists.ts";
import { listShelf } from "../../src/libby-shelf.ts";
import type { LibbyTag } from "../../src/libby-tags-cache.ts";
import {
  cachedTagsForAccount,
  libbyAccountKey,
  parseTagsResponse,
  storeTagsForAccount,
} from "../../src/libby-tags-cache.ts";
import { silentLogger } from "../../src/logger.ts";
import { Runner, selectCards } from "../../src/runner.ts";
import { disconnectedAdapter, fableAdapter, libbyAdapter } from "../../src/sync-adapters.ts";
import { resolveSyncSettings } from "../../src/sync-config.ts";
import { createSyncOrchestrator } from "../../src/sync-orchestrator.ts";
import type { SyncAdapter, SyncContext } from "../../src/sync-plan.ts";
import { ThunderClient } from "../../src/thunder-client.ts";
import type { LibraryApi } from "../../ui/src/lib/api.ts";
import { createFableGet, createFablePost, isFableSignedIn } from "./fable-get.ts";
import { libbyClient, libbyProblem } from "./libby-session.ts";
import { shelfHistory } from "./sync-shelf-history.ts";

const SETTINGS_KEY = "syncSettings";
export const LIBBY_TAGS_CACHE_KEY = "libbyTags";
const context: SyncContext = { userId: "local", connectionId: "libby-and-fable" };
const observedShelf = new WeakMap<SyncAdapter, string>();
const publicCatalog: CatalogReader = new ThunderClient({
  timeoutMs: 8_000,
  retries: 0,
  retryBaseMs: 250,
  userAgent: "villian-discovery-extension",
  logger: silentLogger,
});

export type { LibbyTag } from "../../src/libby-tags-cache.ts";
export {
  cachedTagsForAccount,
  libbyAccountKey,
  parseTagsResponse,
  storeTagsForAccount,
} from "../../src/libby-tags-cache.ts";

/** Use this function to obtain the current authenticated Libby client and account key. Inputs are none; dependencies are `libbyClient`, `LibbyClient.sync`, and `libbyAccountKey`. */
async function activeLibbyAccount() {
  const client = await libbyClient();
  if (!client) return undefined;
  const state = await client.sync();
  return state.cards?.length ? { client, accountKey: libbyAccountKey(state.cards) } : undefined;
}

/** Use this function to check which apps this Chrome profile is signed in to. */
export async function connections() {
  const [libby, fable] = await Promise.all([libbyClient().then(Boolean), isFableSignedIn().catch(() => false)]);
  return { libby, fable, libbyProblem: libby ? "" : libbyProblem() };
}

/** Use this function to read, validate and cache Libby tags for the signed-in account. */
export async function tags(): Promise<LibbyTag[]> {
  const account = await activeLibbyAccount();
  if (!account) throw new Error(libbyProblem() || "Sign in to Libby first");
  const next = parseTagsResponse(await account.client.tags());
  const stored = (await chrome.storage.local.get(LIBBY_TAGS_CACHE_KEY))[LIBBY_TAGS_CACHE_KEY];
  await chrome.storage.local.set({
    [LIBBY_TAGS_CACHE_KEY]: storeTagsForAccount(stored, account.accountKey, next),
  });
  return next;
}

/** Use this function to restore validated tags for the signed-in account without reading or persisting its session token. */
export async function cachedTags(): Promise<LibbyTag[] | undefined> {
  const account = await activeLibbyAccount();
  if (!account) return undefined;
  const stored = (await chrome.storage.local.get(LIBBY_TAGS_CACHE_KEY))[LIBBY_TAGS_CACHE_KEY];
  return cachedTagsForAccount(stored, account.accountKey);
}

/** Use this function to open a loan in the existing Libby tab; it opens a new tab only when none exists, because a second tab breaks the setup-code copy. */
export async function openInLibby(url: string) {
  const [tab] = await chrome.tabs.query({ url: "https://libbyapp.com/*" });
  if (tab?.id === undefined) return void (await chrome.tabs.create({ url }));
  await chrome.tabs.update(tab.id, { url, active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

/** Use this function to build live adapters; an app that is signed out reads as not connected. */
async function adapters() {
  const [client, fable] = await Promise.all([libbyClient(), isFableSignedIn().catch(() => false)]);
  if (!client && !fable) throw new Error("Sign in to Libby or Fable first");
  const libby = client
    ? libbyAdapter(
        client,
        (state) => {
          if (state.cards?.length && Array.isArray(state.loans))
            observedShelf.set(libby, `pendingShelf:${libbyAccountKey(state.cards)}`);
          else observedShelf.delete(libby);
        },
        publicCatalog,
      )
    : disconnectedAdapter();
  return {
    libby,
    fable: fable ? fableAdapter(createFableGet(), createFablePost()) : disconnectedAdapter(),
  };
}

async function loadSettings() {
  return resolveSyncSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] ?? {});
}

const sync = createSyncOrchestrator({
  context,
  adapters,
  readSettings: loadSettings,
  writeSettings: async (settings) => chrome.storage.local.set({ [SETTINGS_KEY]: settings }),
  async onPreview(plan, { libby }) {
    const key = observedShelf.get(libby);
    if (!key) return;
    await navigator.locks
      .request(key, async () => {
        const entries = shelfHistory((await chrome.storage.local.get(key))[key], plan);
        const current = new Set(plan.snapshots.libby.map((book) => book.bookId));
        plan.pendingReturned = entries
          .filter(({ loanIds }) => !loanIds.some((id) => current.has(id)))
          .map(({ bookId, title, progress }) => ({ bookId, title, ...(progress !== undefined ? { progress } : {}) }));
        await chrome.storage.local.set({ [key]: entries });
      })
      .catch(() => undefined);
  },
  async onApply(plan, report, { libby }) {
    const key = observedShelf.get(libby);
    if (!key) return;
    await navigator.locks
      .request(key, async () => {
        const entries = shelfHistory((await chrome.storage.local.get(key))[key], plan, report);
        await chrome.storage.local.set({ [key]: entries });
      })
      .catch(() => undefined);
  },
});

/** Use this function to build the production Runner over the authenticated Libby client and public Thunder catalog. Inputs are the client and validated UI config; dependencies are `Runner`, `ThunderClient`, and `silentLogger`. */
function createRunner(client: Awaited<ReturnType<typeof libbyClient>>, config: Config): Runner {
  if (!client) throw new Error("Connect Libby first");
  return new Runner(config, {
    libby: client,
    thunder: new ThunderClient({
      ...config.http,
      logger: silentLogger,
      ...(config.http.thunderBaseUrl ? { baseUrl: config.http.thunderBaseUrl } : {}),
    }),
    logger: silentLogger,
  });
}

/** The UI's API over the signed-in Chrome profile; sync reads both apps and never writes. */
export const extensionApi: LibraryApi = {
  tags,
  listAvailability: async (titleId) => {
    const client = await libbyClient();
    if (!client) throw new Error(libbyProblem() || "Connect Libby first");
    return listLibraryAvailability(titleId, client, publicCatalog);
  },
  lists: async () => {
    const client = await libbyClient();
    if (!client) throw new Error(libbyProblem() || "Connect Libby first");
    return readLists(client);
  },
  demo: false,
  status: async () => ({ connected: (await connections()).libby }),
  login: async (_tokenFile, { signal }) => {
    await chrome.tabs.create({ url: "https://libbyapp.com/" });
    // The tab's own sign-in finishes this call: poll until an identity with cards appears.
    while (!(await libbyClient())) {
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  },
  cards: async () => {
    const client = await libbyClient();
    if (!client) throw new Error("Connect Libby first");
    return (await client.sync()).cards ?? [];
  },
  shelf: async () => {
    const client = await libbyClient();
    if (!client) throw new Error(libbyProblem() || "Connect Libby first");
    return listShelf(client, publicCatalog);
  },
  search: async (book, config) => {
    const client = await libbyClient();
    if (!client) throw new Error(libbyProblem() || "Connect Libby first");
    const cards = (await client.sync()).cards ?? [];
    return createRunner(client, config).searchMatches(book, selectCards(cards, config));
  },
  run: async (books, config) => {
    const client = await libbyClient();
    if (!client) throw new Error(libbyProblem() || "Connect Libby first");
    return createRunner(client, config).run(books);
  },
  previewSync: sync.previewSync,
  applySync: sync.applySync,
  getSyncSettings: sync.getSettings,
  saveSyncSettings: sync.saveSettings,
};
