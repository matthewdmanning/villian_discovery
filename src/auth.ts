import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AuthError } from "./errors.js";
import type { LibbyClient } from "./libby-client.js";

interface TokenFile {
  identity: string;
  savedAt: string;
}

/** Token from config/env first, then the token file. */
export async function resolveIdentityToken(auth: { identityToken?: string | undefined; tokenFile: string }): Promise<string> {
  if (auth.identityToken) return auth.identityToken;
  const saved = await readTokenFile(auth.tokenFile);
  if (saved) return saved;
  throw new AuthError(
    `No Libby identity token. Run \`libby-shelf login --code <8-digit code>\`, ` +
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
  await writeFile(path, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * Libby setup-code login: new chip, link it with the code, verify cards.
 * Code comes from Libby: Menu > Copy To Another Device. It expires quickly.
 */
export async function loginWithSetupCode(client: LibbyClient, code: string): Promise<string> {
  const identity = await client.createChip();
  await client.cloneByCode(code);
  const state = await client.sync();
  if (!state.cards?.length) {
    throw new AuthError("Linked to Libby, but the account has no library cards.");
  }
  return identity;
}
