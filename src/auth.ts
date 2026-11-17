import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Page, Request } from "playwright-core";
import { type BrowserSession, LOGIN_PROMPT, LOGIN_TIMEOUT_MS, openSite } from "./discovery/browser.js";
import { AuthError } from "./errors.js";
import type { HttpOptions } from "./http.js";
import { LibbyClient } from "./libby-client.js";

interface TokenFile {
  identity: string;
  savedAt: string;
}

/** Token from config/env first, then the token file. */
export async function resolveIdentityToken(auth: {
  identityToken?: string | undefined;
  tokenFile: string;
}): Promise<string> {
  if (auth.identityToken) return auth.identityToken;
  const saved = await readTokenFile(auth.tokenFile);
  if (saved) return saved;
  throw new AuthError(
    `No Libby identity token. Run \`libby-shelf login\`, ` +
      `or set LIBBY_IDENTITY_TOKEN (libbyapp.com localStorage key "dewey:sentry.identity").`,
  );
}

/** Use this function to read the identity token from libbyapp.com's `dewey:sentry.identity` storage value, which may be raw or JSON-quoted. */
export function identityFromLibbyStorage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed ? parsed : undefined;
  } catch {
    return raw;
  }
}

export async function readTokenFile(path: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as Partial<TokenFile>;
    return typeof parsed.identity === "string" && parsed.identity ? parsed.identity : undefined;
  } catch {
    throw new AuthError(`Token file ${path} is not valid JSON`);
  }
}

export async function writeTokenFile(path: string, identity: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const body: TokenFile = { identity, savedAt: new Date().toISOString() };
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

// A first visit starts at Libby's Welcome screen; the root lets Libby route signed-in and new users itself.
const LIBBY_URL = "https://libbyapp.com/";

/** Use this function to read the identity token that libbyapp.com stored in the page. */
async function storedLibbyIdentity(page: Page): Promise<string | undefined> {
  return identityFromLibbyStorage(
    await page.evaluate(() => localStorage.getItem("dewey:sentry.identity")).catch(() => null),
  );
}

/** Use this function to check that an identity token is signed in; Libby's anonymous identity has no cards. */
async function hasLibbyCards(http: HttpOptions, identityToken: string): Promise<boolean | undefined> {
  const state = await new LibbyClient({ ...http, identityToken }).sync().catch(() => undefined);
  return state && !!state.cards?.length;
}

/**
 * Use this function to clear libbyapp.com's data when it holds no identity with cards. A stored library or an
 * anonymous identity makes Libby route to its Shelf and hide the Welcome screen, so the user cannot sign in.
 */
async function resetAnonymousLibby(page: Page, http: HttpOptions): Promise<void> {
  const identityToken = await storedLibbyIdentity(page);
  if (identityToken && (await hasLibbyCards(http, identityToken)) !== false) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", { origin: new URL(LIBBY_URL).origin, storageTypes: "all" });
  await cdp.detach();
  await page.goto(LIBBY_URL).catch(() => {});
}

/**
 * Use this function to wait until the user signs in to libbyapp.com in the browser session, then save the
 * identity token of an account with cards. Libby's own setup steps run in that window.
 */
export async function signInToLibby(
  opened: BrowserSession,
  opts: { http: HttpOptions; tokenFile: string; log: (message: string) => void },
): Promise<void> {
  // libbyapp.com sends its identity as a Bearer token to its own API hosts (sentry., vandal.); read it from those requests.
  const tokens = new Set<string>();
  const collect = (request: Request) => {
    const authorization = request.headers().authorization;
    if (authorization?.startsWith("Bearer ") && new URL(request.url()).hostname.endsWith(".libbyapp.com"))
      tokens.add(authorization.slice("Bearer ".length));
  };
  opened.context.on("request", collect);
  try {
    const page = await openSite(opened, LIBBY_URL);
    await resetAnonymousLibby(page, opts.http);
    opts.log(`Sign in to Libby in the browser window. ${LOGIN_PROMPT}`);
    for (const deadline = Date.now() + LOGIN_TIMEOUT_MS; Date.now() < deadline; await sleep(3_000)) {
      if (opened.isClosed() || page.isClosed())
        throw new AuthError("The Libby window was closed before sign-in finished");
      const stored = await storedLibbyIdentity(page);
      for (const identityToken of stored ? [...tokens, stored] : tokens) {
        if (!(await hasLibbyCards(opts.http, identityToken))) continue;
        await writeTokenFile(opts.tokenFile, identityToken);
        await page.close().catch(() => {});
        return;
      }
    }
    throw new AuthError("No Libby sign-in seen. Sign in to Libby in the browser window, then try again.");
  } finally {
    opened.context.off("request", collect);
  }
}

export interface PairingOptions {
  onCode(code: string, expiresAt: number | undefined): void;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/** Display a new-device code and await approval from the user's existing Libby device. */
export async function loginWithDeviceCode(client: LibbyClient, options: PairingOptions): Promise<string> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 300_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const previous = client.identityToken;
  try {
    signal.throwIfAborted();
    await client.createChip(signal);
    let code: string | undefined;
    let expiry: number | undefined;
    for (;;) {
      signal.throwIfAborted();
      const response = await client.setupCode(code, signal);
      if (response.result === "fulfilled") {
        return await finishPairing(client, response.blessing, signal);
      }
      if (!response.code || !/^\d{8}$/.test(response.code)) {
        throw new AuthError("Libby did not return a valid setup code.");
      }
      if (response.code !== code || response.expiry !== expiry) {
        code = response.code;
        expiry = response.expiry;
        options.onCode(code, expiry === undefined ? undefined : expiry * 1000);
      }
      await sleep(options.pollIntervalMs ?? 3000, undefined, { signal });
    }
  } catch (error) {
    client.identityToken = previous;
    if (signal.aborted && !options.signal?.aborted) {
      throw new AuthError("Libby pairing timed out. Run login again to display a new setup code.");
    }
    throw error;
  }
}

/** Optional compatibility flow; the normal login displays a code on this device. */
export async function loginWithSetupCode(client: LibbyClient, code: string, signal?: AbortSignal): Promise<string> {
  if (!/^\d{8}$/.test(code)) throw new AuthError("Libby setup code must be 8 digits");
  const previous = client.identityToken;
  try {
    await client.createChip(signal);
    const response = await client.cloneByCode(code, signal);
    return await finishPairing(client, response.blessing, signal);
  } catch (error) {
    client.identityToken = previous;
    throw error;
  }
}

async function finishPairing(client: LibbyClient, blessing?: string, signal?: AbortSignal): Promise<string> {
  if (!blessing || blessing === "failure") throw new AuthError("Libby pairing approval was not granted.");
  const identity = await client.completeClone(blessing, signal);
  signal?.throwIfAborted();
  const state = await client.sync(signal);
  signal?.throwIfAborted();
  if (!state.cards?.length) throw new AuthError("Linked to Libby, but the account has no library cards.");
  return identity;
}
