export * from "./errors.js";
export * from "./config.js";
export * from "./input.js";
export * from "./matcher.js";
export * from "./planner.js";
export * from "./runner.js";
export * from "./report.js";
export * from "./auth.js";
export { LibbyClient, DEFAULT_SENTRY_BASE_URL, isValidSuspendDays } from "./libby-client.js";
export { ThunderClient, DEFAULT_THUNDER_BASE_URL, type LibrarySearch } from "./thunder-client.js";
export { createLogger, type Logger, type LogLevel } from "./logger.js";
export type * from "./types.js";

import { type Config, type ConfigInput, configFromEnv, mergeConfig, parseConfig } from "./config.js";
import { resolveIdentityToken } from "./auth.js";
import { LibbyClient } from "./libby-client.js";
import { ThunderClient } from "./thunder-client.js";
import { type Logger, createLogger } from "./logger.js";
import type { BookRequest } from "./input.js";
import { type BookResult, Runner } from "./runner.js";

/** Builds clients from a parsed config. `fetch` is injectable for tests. */
export async function createClients(cfg: Config, opts: { fetch?: typeof fetch; logger?: Logger } = {}) {
  const logger = opts.logger ?? createLogger(cfg.logLevel);
  const http = { ...cfg.http, logger, ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  const identityToken = await resolveIdentityToken(cfg.auth);
  const libby = new LibbyClient({
    ...http,
    identityToken,
    ...(cfg.http.sentryBaseUrl ? { baseUrl: cfg.http.sentryBaseUrl } : {}),
  });
  const thunder = new ThunderClient({
    ...http,
    ...(cfg.http.thunderBaseUrl ? { baseUrl: cfg.http.thunderBaseUrl } : {}),
  });
  return { libby, thunder, logger };
}

/** One-call API: borrow or hold every book. Config layers: env < `config`. */
export async function processBooks(
  books: BookRequest[],
  config: ConfigInput = {},
  opts: { fetch?: typeof fetch; logger?: Logger; onResult?: (r: BookResult) => void } = {},
): Promise<BookResult[]> {
  const cfg = parseConfig(mergeConfig(configFromEnv(), config));
  const deps = await createClients(cfg, opts);
  return new Runner(cfg, deps).run(books, opts.onResult);
}
