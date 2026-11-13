import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ConfigError } from "./errors.js";
import { isValidSuspendDays } from "./libby-client.js";

export const MediaTypeSchema = z.enum(["ebook", "audiobook", "magazine"]);
export const ActionSchema = z.enum(["auto", "borrow", "hold"]);

const DEFAULT_TOKEN_FILE = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "libby-shelf",
  "identity.json",
);

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    auth: z
      .object({
        /** Libby identity (Bearer) token. Prefer env LIBBY_IDENTITY_TOKEN. */
        identityToken: z.string().min(1).optional(),
        /** Where `login` stores, and `run` reads, the identity token. */
        tokenFile: z.string().default(DEFAULT_TOKEN_FILE),
      })
      .prefault({}),

    /**
     * What to do per book. Per-book `action` overrides it.
     * - auto: borrow if a copy is available now, else place a hold.
     * - borrow: borrow only; skip unavailable titles.
     * - hold: always place a hold (Libby may deliver at once if available).
     */
    action: ActionSchema.default("auto"),

    /** Library keys (card `advantageKey`) in priority order. Empty = all cards, Libby order. */
    libraries: z.array(z.string()).default([]),
    /** Restrict to these card ids or card names. Empty = all. */
    cards: z.array(z.string()).default([]),

    /** Media types to accept, in preference order. */
    mediaTypes: z.array(MediaTypeSchema).min(1).default(["ebook", "audiobook"]),

    borrow: z
      .object({
        /** "preference" = card's saved preference; "max" = longest offered; or a fixed day count. */
        lendingPeriod: z
          .union([z.literal("preference"), z.literal("max"), z.number().int().positive()])
          .default("preference"),
        /** Allow borrowing Lucky Day / Skip-the-line copies. */
        luckyDay: z.boolean().default(true),
        /** Stop borrowing after this many loans in one run. */
        maxPerRun: z.number().int().positive().optional(),
      })
      .prefault({}),

    hold: z
      .object({
        /**
         * Where to place holds when no library has a copy:
         * - best: one hold at the library with the shortest estimated wait.
         * - first: one hold at the first library (priority order) that owns it.
         * - all: a hold at every library that owns it.
         */
        placement: z.enum(["best", "first", "all"]).default("best"),
        /** Skip the hold if the estimated wait exceeds this many days. */
        maxEstimatedWaitDays: z.number().int().nonnegative().optional(),
        /** Skip the hold if more than this many people are waiting. */
        maxHoldsCount: z.number().int().nonnegative().optional(),
        /** After placing, suspend ("deliver later") for N days (0-30, 60, 90). */
        suspendDays: z.number().int().refine(isValidSuspendDays, "must be 0-30, 60 or 90").default(0),
        /** Notification email Libby stores on the hold. */
        emailAddress: z.string().optional(),
        /** Stop placing holds after this many in one run. */
        maxPerRun: z.number().int().positive().optional(),
      })
      .prefault({}),

    matching: z
      .object({
        /** Minimum 0-1 similarity between requested and found title. */
        minTitleScore: z.number().min(0).max(1).default(0.85),
        /** Minimum 0-1 similarity for author, when an author is given. */
        minAuthorScore: z.number().min(0).max(1).default(0.6),
        /** Ignore subtitles when comparing titles. */
        ignoreSubtitle: z.boolean().default(true),
        /** Allow pre-release titles (holds only). */
        allowPreRelease: z.boolean().default(true),
        /** Search results to examine per library. */
        perPage: z.number().int().min(1).max(100).default(24),
      })
      .prefault({}),

    /** Skip titles already on loan or on hold on any card. */
    skipExisting: z.boolean().default(true),
    /** Skip a card whose loan/hold limit is reached. */
    respectCardLimits: z.boolean().default(true),
    /** Plan only. Never borrows or places holds. */
    dryRun: z.boolean().default(false),
    /** Pause between books, to be polite to the API. */
    delayMs: z.number().int().nonnegative().default(750),
    /** Stop the whole run on the first error instead of continuing. */
    failFast: z.boolean().default(false),

    http: z
      .object({
        timeoutMs: z.number().int().positive().default(30_000),
        retries: z.number().int().nonnegative().default(2),
        retryBaseMs: z.number().int().positive().default(500),
        userAgent: z
          .string()
          .default(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
          ),
        sentryBaseUrl: z.url().optional(),
        thunderBaseUrl: z.url().optional(),
      })
      .prefault({}),

    output: z
      .object({
        format: z.enum(["table", "json", "ndjson"]).default("table"),
        /** Also write the JSON report to this path. */
        reportFile: z.string().optional(),
      })
      .prefault({}),

    logLevel: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
  })
  .strict();

export type Config = z.output<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

/** Deep-merges plain objects; arrays and scalars on the right win. */
export function mergeConfig(...layers: (ConfigInput | undefined)[]): ConfigInput {
  const out: Record<string, unknown> = {};
  for (const layer of layers) if (layer) deepMerge(out, layer as Record<string, unknown>);
  return out as ConfigInput;
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || UNSAFE_KEYS.has(k)) continue;
    const cur = Object.hasOwn(target, k) ? target[k] : undefined;
    if (isPlainObject(v) && isPlainObject(cur)) deepMerge(cur, v);
    else target[k] = isPlainObject(v) ? deepMerge({}, v) : v;
  }
  return target;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseConfig(input: unknown): Config {
  const r = ConfigSchema.safeParse(input);
  if (!r.success) throw new ConfigError(`Invalid configuration:\n${z.prettifyError(r.error)}`);
  return r.data;
}

/** Config from env vars. Only secrets and common toggles; files cover the rest. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ConfigInput {
  const c: ConfigInput = {};
  if (env.LIBBY_IDENTITY_TOKEN) c.auth = { identityToken: env.LIBBY_IDENTITY_TOKEN };
  if (env.LIBBY_TOKEN_FILE) c.auth = { ...c.auth, tokenFile: env.LIBBY_TOKEN_FILE };
  if (env.LIBBY_DRY_RUN) c.dryRun = /^(1|true|yes)$/i.test(env.LIBBY_DRY_RUN);
  return c;
}

export async function loadConfigFile(path: string): Promise<ConfigInput> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    throw new ConfigError(`Cannot read config file ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as ConfigInput;
  } catch (e) {
    throw new ConfigError(`Config file ${path} is not valid JSON: ${(e as Error).message}`);
  }
}
