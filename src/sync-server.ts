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
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Page, Request } from "playwright-core";
import { identityFromLibbyStorage, readTokenFile, writeTokenFile } from "./auth.js";
import { configFromEnv, mergeConfig, parseConfig } from "./config.js";
import { type BrowserSession, LOGIN_PROMPT, LOGIN_TIMEOUT_MS, openBrowserSession } from "./discovery/browser.js";
import { browserGet, type FableGet, LIBRARY_URL, waitForLogin } from "./discovery/export-lists.js";
import { LibbyClient } from "./libby-client.js";
import { createLogger } from "./logger.js";
import { disconnectedAdapter, fableAdapter, libbyAdapter } from "./sync-adapters.js";
import { resolveSyncSettings, SyncSettingsSchema } from "./sync-config.js";
import { applySync, createMemoryJournal, previewSync, type SyncContext, type SyncPlan } from "./sync-plan.js";

const PORT = Number(process.env.LIBBY_SHELF_PORT ?? 8787);
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
const SETTINGS_FILE = join(dirname(config.auth.tokenFile), "sync-settings.json");
const context: SyncContext = { userId: "local", connectionId: "libby-and-fable" };
const journal = createMemoryJournal();
const plans = new Map<string, SyncPlan>();
let matches: Record<string, string> = {};
let fable: Promise<FableGet> | undefined;
let browser: Promise<BrowserSession> | undefined;
// A first visit starts at Libby's Welcome screen; the root lets Libby route signed-in and new users itself.
const LIBBY_URL = "https://libbyapp.com/";

/** Use this function to get a Libby client for the saved login; it throws when no one has signed in. */
async function libby(): Promise<LibbyClient> {
  const identityToken = config.auth.identityToken ?? (await readTokenFile(config.auth.tokenFile));
  if (!identityToken) throw new Error("Connect Libby first");
  return new LibbyClient({ ...http, identityToken });
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

/** Use this function to open a site in the shared browser, reusing the first blank tab. */
async function openSite(opened: BrowserSession, url: string): Promise<Page> {
  const page = opened.page.url() === "about:blank" ? opened.page : await opened.context.newPage();
  await page.goto(url).catch(() => {});
  return page;
}

/** Use this function to wait until the user signs in to libbyapp.com, then save the identity token of an account with cards. */
async function signInToLibby(): Promise<void> {
  const opened = await session();
  // libbyapp.com sends its identity as a Bearer token to OverDrive's API; read it from those requests.
  const tokens = new Set<string>();
  const collect = (request: Request) => {
    const authorization = request.headers().authorization;
    if (authorization?.startsWith("Bearer ") && new URL(request.url()).hostname.endsWith(".overdrive.com"))
      tokens.add(authorization.slice("Bearer ".length));
  };
  opened.context.on("request", collect);
  try {
    const page = await openSite(opened, LIBBY_URL);
    logger.info(`Sign in to Libby in the browser window. ${LOGIN_PROMPT}`);
    for (const deadline = Date.now() + LOGIN_TIMEOUT_MS; Date.now() < deadline; await sleep(3_000)) {
      if (opened.isClosed() || page.isClosed()) throw new Error("The Libby window was closed before sign-in finished");
      const stored = identityFromLibbyStorage(
        await page.evaluate(() => localStorage.getItem("dewey.sentry.identity")).catch(() => null),
      );
      for (const identityToken of stored ? [...tokens, stored] : tokens) {
        const state = await new LibbyClient({ ...http, identityToken }).sync().catch(() => undefined);
        // Libby makes an anonymous identity before sign-in; only an identity with cards is signed in.
        if (!state?.cards?.length) continue;
        await writeTokenFile(config.auth.tokenFile, identityToken);
        await page.close().catch(() => {});
        return;
      }
    }
    throw new Error("No Libby sign-in seen. Sign in to Libby in the browser window, then try again.");
  } finally {
    opened.context.off("request", collect);
  }
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

type Handler = (input: unknown) => Promise<unknown>;
const routes: Record<string, Handler> = {
  "GET /api/status": async () => ({
    connected: !!(config.auth.identityToken ?? (await readTokenFile(config.auth.tokenFile))),
  }),
  "POST /api/login": async () => {
    await signInToLibby();
    return {};
  },
  "GET /api/cards": async () => (await (await libby()).sync()).cards ?? [],
  "GET /api/sync/settings": loadSettings,
  "PUT /api/sync/settings": async (input) =>
    journal.withLock(context, async () => {
      const overrides = SyncSettingsSchema.partial().strict().parse(input);
      await writeFile(SETTINGS_FILE, `${JSON.stringify(overrides, null, 2)}\n`);
      plans.clear();
      return resolveSyncSettings(overrides);
    }),
  "POST /api/sync/preview": async (input) => {
    const options = (input ?? {}) as Parameters<typeof previewSync>[0]["options"];
    if (options?.matches) matches = options.matches;
    const plan = await previewSync({
      context,
      settings: await loadSettings(),
      adapters: await adapters(),
      options: { ...options, matches },
    });
    plans.set(plan.id, plan);
    return plan;
  },
  "POST /api/sync/apply": async (input) => {
    const { planId, approvals } = input as { planId?: string; approvals?: unknown };
    const plan = planId ? plans.get(planId) : undefined;
    if (!plan) throw new Error("Preview is unavailable or settings changed; preview again");
    return applySync({
      context,
      settings: await loadSettings(),
      readSettings: loadSettings,
      plan,
      adapters: await adapters(),
      journal,
      approvals: approvals as Parameters<typeof applySync>[0]["approvals"],
    });
  },
};

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

/** Use this function to tell whether libby-shelf already answers on a port. */
async function isRunning(url: string): Promise<boolean> {
  const status = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.json() as Promise<{ connected?: unknown }>)
    .catch(() => undefined);
  return typeof status?.connected === "boolean";
}

const server = createServer(handle);
server.on("listening", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : PORT}`;
  logger.info(`libby-shelf live app on ${url}`);
  openInBrowser(url);
});
// A second launch opens the app that is already running; another program on the port moves the app to a free port.
server.on("error", async (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  const url = `http://127.0.0.1:${PORT}`;
  if (await isRunning(url)) {
    logger.info(`libby-shelf is already running on ${url}`);
    openInBrowser(url);
    process.exit(0);
  }
  server.listen(0, "127.0.0.1");
});
server.listen(PORT, "127.0.0.1");
