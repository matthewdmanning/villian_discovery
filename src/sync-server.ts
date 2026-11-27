#!/usr/bin/env node
/**
 * Local server for the live UI: serves the built UI (`ui/dist`), Libby sign-in and cards, and a read-only
 * sync preview of Libby and Fable. `npm run live` builds everything, starts it, and opens the browser.
 *
 * Binds to 127.0.0.1 only. The Libby token stays in the token file and Fable's login stays in the
 * saved browser profile; neither ever reaches the browser page. Every sync write stays blocked
 * because no provider write contract is verified.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loginWithDeviceCode, readTokenFile, signInToLibby, writeTokenFile } from "./auth.js";
import { type ConfigInput, configFromEnv, mergeConfig, parseConfig } from "./config.js";
import { type BrowserSession, openBrowserSession, openSite } from "./discovery/browser.js";
import { browserGet, type FableGet, LIBRARY_URL, waitForLogin } from "./discovery/export-lists.js";
import { createClients } from "./index.js";
import type { BookRequest } from "./input.js";
import { LibbyClient } from "./libby-client.js";
import { createCardCache, listLibraryAvailability } from "./libby-list-availability.js";
import { readLists } from "./libby-lists.js";
import { listShelf } from "./libby-shelf.js";
import { createLogger } from "./logger.js";
import { createQueryCooldown, withCooldown } from "./query-cooldown.js";
import { Runner, selectCards } from "./runner.js";
import { disconnectedAdapter, fableAdapter, libbyAdapter } from "./sync-adapters.js";
import { resolveSyncSettings } from "./sync-config.js";
import { createSyncOrchestrator, type SyncOrchestrator } from "./sync-orchestrator.js";
import { ThunderClient } from "./thunder-client.js";

const PORT = Number(process.env.LIBBY_SHELF_PORT ?? 8787);
// A rebuild rewrites this file, so its time stamp tells a running copy from a newer build.
const BUILD = String(statSync(fileURLToPath(import.meta.url)).mtimeMs);
const UI_DIR = fileURLToPath(new URL("../ui/dist/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const config = parseConfig(mergeConfig(configFromEnv()));
const logger = createLogger(config.logLevel);
const http = { ...config.http, logger };
const publicCatalog = new ThunderClient({
  ...http,
  timeoutMs: Math.min(http.timeoutMs, 8_000),
  retries: 0,
  ...(config.http.thunderBaseUrl ? { baseUrl: config.http.thunderBaseUrl } : {}),
});
const SETTINGS_FILE = join(dirname(config.auth.tokenFile), "sync-settings.json");
const context = { userId: "local", connectionId: "libby-and-fable" };
let fable: Promise<FableGet> | undefined;
let browser: Promise<BrowserSession> | undefined;
let libbySignIn: Promise<void> | undefined;
let deviceLogin: Promise<void> | undefined;
let deviceCode: string | undefined;

/** Use this function to get a Libby client for the saved login; it throws when no one has signed in. */
async function savedToken(): Promise<string> {
  const identityToken = config.auth.identityToken ?? (await readTokenFile(config.auth.tokenFile));
  if (!identityToken) throw new Error("Connect Libby first");
  return identityToken;
}

async function libby(): Promise<LibbyClient> {
  return new LibbyClient({ ...http, identityToken: await savedToken() });
}

/** Cards change rarely; opening titles in Lists reuses one card list for a minute. */
const listCards = createCardCache(60_000);
async function listAvailability(titleId: string) {
  const identityToken = await savedToken();
  const client = new LibbyClient({ ...http, identityToken });
  return listLibraryAvailability(titleId, { sync: () => listCards(identityToken, () => client.sync()) }, publicCatalog);
}

/** Use this function to build the CLI's runner from the UI's settings; the server's login and HTTP settings always replace the page's, so a page never picks where the token goes. */
async function liveRunner(settings: unknown) {
  const cfg = parseConfig(mergeConfig(settings as ConfigInput, { auth: config.auth, http: config.http }));
  const clients = await createClients(cfg, { logger });
  return { cfg, libby: clients.libby, runner: new Runner(cfg, clients) };
}

/** Use this function to open the saved browser profile once; Libby and Fable share it because the profile allows one window. */
function session(): Promise<BrowserSession> {
  browser ??= openBrowserSession()
    .then((opened) => {
      opened.closed.then(() => {
        browser = undefined;
        fable = undefined;
      });
      return opened;
    })
    .catch((error: unknown) => {
      browser = undefined;
      throw error;
    });
  return browser;
}

/** Use this function to open Fable in the shared browser once and wait for the user's login. */
function fableGet(): Promise<FableGet> {
  fable ??= (async () => {
    const opened = await session();
    const get = browserGet(opened.context, opened.isClosed);
    await openSite(opened, LIBRARY_URL);
    await waitForLogin(get, { isClosed: opened.isClosed, log: (message) => logger.info(message) });
    return get;
  })().catch((error: unknown) => {
    fable = undefined;
    throw error;
  });
  return fable;
}

/** Use this function to build live adapters for every connected app; an app without a login reads as not connected. Fable reads go through the signed-in browser profile, and closing its window without logging in leaves Fable not connected. */
async function adapters() {
  const [client, get] = await Promise.all([libby().catch(() => undefined), fableGet().catch(() => undefined)]);
  if (!client && !get) throw new Error("Connect Libby or log in to Fable first");
  return {
    libby: client ? libbyAdapter(client) : disconnectedAdapter(),
    fable: get ? fableAdapter(get) : disconnectedAdapter(),
  };
}

/** Use this function to load the saved sync overrides over the shipped fallbacks. */
async function loadSettings() {
  const text = await readFile(SETTINGS_FILE, "utf8").catch(() => "{}");
  return resolveSyncSettings(JSON.parse(text));
}

/** Use this function to read and parse a JSON request body. */
async function body(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}

const sync: SyncOrchestrator = createSyncOrchestrator({
  context,
  adapters,
  readSettings: loadSettings,
  writeSettings: async (settings) => writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`),
});

type Handler = (input: unknown) => Promise<unknown>;
const apiRoutes: Record<string, Handler> = {
  "GET /api/status": async () => ({
    connected: !!(config.auth.identityToken ?? (await readTokenFile(config.auth.tokenFile))),
    build: BUILD,
    pid: process.pid,
  }),
  "POST /api/login": async () => {
    // Every open app tab asks to sign in; they all wait on one sign-in, so Libby sees one device.
    libbySignIn ??= session()
      .then((opened) => signInToLibby(opened, { http, tokenFile: config.auth.tokenFile, log: (m) => logger.info(m) }))
      .finally(() => {
        libbySignIn = undefined;
      });
    await libbySignIn;
    return {};
  },
  "POST /api/login/device-code": async () => {
    // Libby's API shows a setup code for the user's existing Libby device; GET returns the current code.
    deviceLogin ??= loginWithDeviceCode(new LibbyClient(http), {
      onCode: (code) => {
        deviceCode = code;
      },
    })
      .then((identity) => writeTokenFile(config.auth.tokenFile, identity))
      .finally(() => {
        deviceLogin = undefined;
        deviceCode = undefined;
      });
    await deviceLogin;
    return {};
  },
  "GET /api/login/device-code": async () => ({ code: deviceCode }),
  "GET /api/cards": async () => (await (await libby()).sync()).cards ?? [],
  "GET /api/shelf": async () => listShelf(await libby(), publicCatalog, logger),
  "GET /api/lists": async () => readLists(await libby()),
  "POST /api/lists/availability": async (input) => listAvailability((input as { titleId: string })?.titleId),
  "GET /api/tags": async () => (await libby()).tags(),
  "POST /api/search": async (input) => {
    const { book, config: settings } = input as { book: BookRequest; config?: unknown };
    const { runner, cfg, libby } = await liveRunner(settings);
    return runner.searchMatches(book, selectCards((await libby.sync()).cards ?? [], cfg));
  },
  "POST /api/run": async (input) => {
    const { books, config: settings } = input as { books: BookRequest[]; config?: unknown };
    return (await liveRunner(settings)).runner.run(books);
  },
  "GET /api/sync/settings": sync.getSettings,
  "PUT /api/sync/settings": sync.saveSettings,
  "POST /api/sync/preview": async (input) => {
    return sync.previewSync((input ?? {}) as Parameters<typeof sync.previewSync>[0]);
  },
  "POST /api/sync/apply": async (input) => {
    const { planId, approvals } = input as { planId?: string; approvals?: unknown };
    return sync.applySync(planId ?? "", approvals);
  },
};

// External reads share results for a short cooldown so repeated clicks do not hammer Libby, Fable or catalogs.
const routes = withCooldown(
  apiRoutes,
  {
    reads: [
      "GET /api/cards",
      "GET /api/shelf",
      "GET /api/lists",
      "POST /api/lists/availability",
      "GET /api/tags",
      "POST /api/search",
      "POST /api/sync/preview",
    ],
    // Anything that changes an account or settings makes kept reads stale.
    writes: [
      "POST /api/login",
      "POST /api/login/device-code",
      "POST /api/run",
      "PUT /api/sync/settings",
      "POST /api/sync/apply",
    ],
  },
  createQueryCooldown(),
);

/** Use this function to serve one built UI file; unknown paths get the app page. */
async function serveUi(pathname: string, response: ServerResponse) {
  const file = join(UI_DIR, decodeURIComponent(pathname));
  const path = extname(file) && file.startsWith(UI_DIR) ? file : join(UI_DIR, "index.html");
  const content = await readFile(path).catch(() => undefined);
  if (!content) return response.writeHead(404).end("Build the UI first: npm run live");
  response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(content);
}

/** Use this function to answer one API request as JSON, or serve the UI; errors carry only their message. */
async function handle(request: IncomingMessage, response: ServerResponse) {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (!pathname.startsWith("/api/")) return serveUi(pathname, response);
  const route = routes[`${request.method} ${pathname}`];
  const send = (status: number, value: unknown) =>
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  if (!route) return send(404, { error: "Not found" });
  // Another website can post to 127.0.0.1 too; only the app's own page may borrow books or sign in.
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) return send(403, { error: "Forbidden" });
  try {
    send(200, await route(await body(request)));
  } catch (error) {
    send(400, { error: error instanceof Error ? error.message : "Request failed" });
  }
}

/** Use this function to open the app in the user's default browser. */
function openInBrowser(url: string) {
  const [command, ...args] =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : [process.platform === "darwin" ? "open" : "xdg-open", url];
  execFile(command!, args, () => {});
}

/** Use this function to read the status of a libby-shelf that already answers on a port; another program gives undefined. */
async function runningStatus(url: string): Promise<{ build?: unknown; pid?: unknown } | undefined> {
  const status = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.json() as Promise<{ connected?: unknown; build?: unknown; pid?: unknown }>)
    .catch(() => undefined);
  return typeof status?.connected === "boolean" ? status : undefined;
}

const server = createServer(handle);
server.on("listening", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : PORT}`;
  logger.info(`libby-shelf live app on ${url}`);
  // A launcher restart keeps the open page, which reconnects on its own.
  if (!process.env.LIBBY_SHELF_RESTART) openInBrowser(url);
});
// A second launch opens the copy that is already running, or replaces that copy when it runs an older build.
// Another program on the port moves the app to a free port.
let replacedOlderCopy = false;
server.on("error", async (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  const url = `http://127.0.0.1:${PORT}`;
  const status = await runningStatus(url);
  if (status?.build === BUILD || (status && replacedOlderCopy)) {
    logger.info(`libby-shelf is already running on ${url}`);
    openInBrowser(url);
    process.exit(0);
  }
  if (status && typeof status.pid === "number") {
    logger.info(`Replacing an older libby-shelf on ${url}`);
    replacedOlderCopy = true;
    process.kill(status.pid);
    await sleep(1_000);
    return server.listen(PORT, "127.0.0.1");
  }
  server.listen(0, "127.0.0.1");
});
server.listen(PORT, "127.0.0.1");
