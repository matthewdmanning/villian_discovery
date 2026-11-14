/**
 * The user's installed Chrome or Edge on a saved profile, shared by `capture` and `export-lists`.
 *
 * The profile persists, so later runs start logged in. The tool never logs in for the user.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright-core";

const CHANNELS = ["chrome", "msedge"] as const;
/** Holds the saved login. Keep it out of the repo. */
export const PROFILE_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "libby-shelf",
  "browser-profile",
);
/** How long commands wait for the user to log in. */
export const LOGIN_TIMEOUT_MS = 10 * 60_000;
export const LOGIN_PROMPT = "The tool continues on its own after you log in.";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  /** Resolves when the user closes the window (or the last tab). */
  closed: Promise<void>;
  isClosed(): boolean;
}

/** Opens Chrome or Edge on the saved profile. */
export async function launchInstalledBrowser(): Promise<BrowserContext> {
  const errors: unknown[] = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { channel, headless: false, viewport: null });
    } catch (e) {
      errors.push(e); // try the next browser
    }
  }
  throw new Error(
    "Could not open a browser. Close any other window this tool opened (it locks the saved login), and install Google Chrome or Microsoft Edge if neither is installed. Then try again.",
    { cause: new AggregateError(errors) },
  );
}

/** Launches the browser and tracks when the user closes it. Closing the last tab closes the session. */
export async function openBrowserSession(): Promise<BrowserSession> {
  const context = await launchInstalledBrowser();
  let isClosed = false;
  const closed = new Promise<void>((resolve) =>
    context.on("close", () => {
      isClosed = true;
      resolve();
    }),
  );
  const watch = (p: Page) => p.on("close", () => context.pages().length || context.close().catch(() => {}));
  context.pages().forEach(watch);
  context.on("page", watch);
  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page, closed, isClosed: () => isClosed };
}
