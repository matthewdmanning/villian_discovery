import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AuthError } from "./errors.js";
import type { LibbyClient } from "./libby-client.js";

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
      `or set LIBBY_IDENTITY_TOKEN (libbyapp.com localStorage key "dewey.sentry.identity").`,
  );
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
      await delay(options.pollIntervalMs ?? 3000, undefined, { signal });
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
