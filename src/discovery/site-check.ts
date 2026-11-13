/**
 * Config-driven website / endpoint checks.
 *
 * Each site: request → assert status, content type, body text, JSON Schema, latency.
 * Pure apart from the injected `fetch`, so tests run offline.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { JsonSchema } from "./schema.js";
import { type SchemaViolation, validateSchema } from "./validate.js";

const StatusSpec = z.union([
  z.number().int().min(100).max(599),
  z.string().regex(/^[1-5]xx$/, "use e.g. 2xx"),
  z.string().regex(/^\d{3}-\d{3}$/, "use e.g. 200-399"),
]);
export type StatusSpec = z.infer<typeof StatusSpec>;

const CheckOptions = z
  .object({
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    headers: z.record(z.string(), z.string()),
    body: z.unknown(),
    timeoutMs: z.number().int().positive(),
    expectStatus: z.array(StatusSpec).min(1),
    expectContentType: z.string(),
    expectBodyIncludes: z.array(z.string()),
    /** Inline schema, or path (relative to the config file) to a JSON Schema file. */
    expectSchema: z.union([z.string(), z.record(z.string(), z.unknown())]),
    maxDurationMs: z.number().int().positive(),
  })
  .partial()
  .strict();

const SiteSchema = CheckOptions.extend({
  name: z.string().min(1).optional(),
  url: z.url({ protocol: /^https?$/ }),
  tags: z.array(z.string()).optional(),
  skip: z.boolean().optional(),
}).strict();

export const SiteTestConfigSchema = z
  .object({
    $schema: z.string().optional(),
    defaults: CheckOptions.optional(),
    /** Run up to N checks at once. */
    concurrency: z.number().int().positive().optional(),
    sites: z.array(SiteSchema).min(1),
  })
  .strict();

export type SiteTestConfig = z.infer<typeof SiteTestConfigSchema>;
export type SiteSpec = z.infer<typeof SiteSchema>;

export const DEFAULTS = {
  method: "GET",
  timeoutMs: 10_000,
  expectStatus: ["200-399"] as StatusSpec[],
  concurrency: 4,
} as const;

export interface CheckResult {
  name: string;
  url: string;
  ok: boolean;
  skipped?: boolean;
  status?: number;
  contentType?: string;
  durationMs: number;
  /** Network / timeout failure: the request never got a response. */
  error?: string;
  failures: string[];
}

export interface RunOptions {
  fetch?: typeof fetch;
  /** Resolve schema file paths against this directory. */
  baseDir?: string;
  /** Only sites whose name, url or tag matches one of these. */
  only?: string[];
  now?: () => number;
}

export function parseSiteTestConfig(raw: unknown): SiteTestConfig {
  return SiteTestConfigSchema.parse(raw);
}

export async function loadSiteTestConfig(path: string): Promise<{ config: SiteTestConfig; baseDir: string }> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return { config: parseSiteTestConfig(raw), baseDir: dirname(resolve(path)) };
}

export function statusMatches(status: number, specs: readonly StatusSpec[]): boolean {
  return specs.some((s) => {
    if (typeof s === "number") return s === status;
    if (s.endsWith("xx")) return Math.floor(status / 100) === Number(s[0]);
    const [lo, hi] = s.split("-").map(Number) as [number, number];
    return status >= lo && status <= hi;
  });
}

export function siteName(site: SiteSpec): string {
  return site.name ?? new URL(site.url).host;
}

function selected(site: SiteSpec, only: string[] | undefined): boolean {
  if (!only?.length) return true;
  return only.some((o) => o === siteName(site) || o === site.url || (site.tags ?? []).includes(o));
}

async function resolveSchema(spec: string | Record<string, unknown>, baseDir: string): Promise<JsonSchema> {
  if (typeof spec !== "string") return spec as JsonSchema;
  return JSON.parse(await readFile(resolve(baseDir, spec), "utf8")) as JsonSchema;
}

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError" || e.name === "AbortError") return "timeout";
  const cause = (e as { cause?: unknown }).cause;
  return cause instanceof Error ? `${e.message}: ${cause.message}` : e.message;
}

const fmtViolation = (v: SchemaViolation) => `schema ${v.path || "/"}: ${v.message}`;

export async function checkSite(site: SiteSpec, config: SiteTestConfig, opts: RunOptions = {}): Promise<CheckResult> {
  const d = config.defaults ?? {};
  const s = {
    ...d,
    ...stripUndefined(site),
    method: site.method ?? d.method ?? DEFAULTS.method,
    timeoutMs: site.timeoutMs ?? d.timeoutMs ?? DEFAULTS.timeoutMs,
    expectStatus: site.expectStatus ?? d.expectStatus ?? DEFAULTS.expectStatus,
    headers: { ...d.headers, ...site.headers },
  };
  const now = opts.now ?? Date.now;
  const name = siteName(site);
  const base: CheckResult = { name, url: site.url, ok: false, durationMs: 0, failures: [] };
  if (site.skip) return { ...base, ok: true, skipped: true };

  const doFetch = opts.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { ...s.headers };
  let body: string | undefined;
  if (s.body !== undefined) {
    body = typeof s.body === "string" ? s.body : JSON.stringify(s.body);
    if (typeof s.body !== "string") headers["content-type"] ??= "application/json";
  }

  const start = now();
  let res: Response;
  try {
    res = await doFetch(site.url, {
      method: s.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "follow",
      signal: AbortSignal.timeout(s.timeoutMs),
    });
  } catch (e) {
    const error = describeError(e);
    return { ...base, durationMs: now() - start, error, failures: [`request failed: ${error}`] };
  }

  const failures: string[] = [];
  const contentType = res.headers.get("content-type") ?? undefined;
  const needsBody = s.method !== "HEAD" && (s.expectBodyIncludes?.length || s.expectSchema !== undefined);
  let text = "";
  if (needsBody) text = await res.text();
  // Not awaited: cancelling one branch of a tee'd stream resolves only when the other branch is cancelled too.
  else res.body?.cancel().catch(() => {});
  const durationMs = now() - start;

  if (!statusMatches(res.status, s.expectStatus)) {
    failures.push(`status ${res.status} not in [${s.expectStatus.join(", ")}]`);
  }
  if (s.expectContentType && !contentType?.toLowerCase().includes(s.expectContentType.toLowerCase())) {
    failures.push(`content-type ${contentType ?? "(none)"} lacks ${s.expectContentType}`);
  }
  for (const needle of s.expectBodyIncludes ?? []) {
    if (!text.includes(needle)) failures.push(`body lacks ${JSON.stringify(needle)}`);
  }
  if (s.expectSchema !== undefined) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      failures.push("body is not JSON");
    }
    if (json !== undefined) {
      const schema = await resolveSchema(s.expectSchema, opts.baseDir ?? process.cwd());
      failures.push(...validateSchema(schema, json).slice(0, 20).map(fmtViolation));
    }
  }
  if (s.maxDurationMs && durationMs > s.maxDurationMs) {
    failures.push(`took ${durationMs}ms > ${s.maxDurationMs}ms`);
  }

  return {
    ...base,
    ok: failures.length === 0,
    status: res.status,
    ...(contentType ? { contentType } : {}),
    durationMs,
    failures,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Run all selected checks; results keep config order. */
export async function runSiteChecks(config: SiteTestConfig, opts: RunOptions = {}): Promise<CheckResult[]> {
  const sites = config.sites.filter((s) => selected(s, opts.only));
  const results: CheckResult[] = new Array(sites.length);
  let next = 0;
  const worker = async () => {
    while (next < sites.length) {
      const i = next++;
      results[i] = await checkSite(sites[i]!, config, opts);
    }
  };
  const n = Math.min(config.concurrency ?? DEFAULTS.concurrency, sites.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

export function formatResults(results: CheckResult[]): string {
  const lines = results.map((r) => {
    const mark = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
    const status = r.status ?? "---";
    const head = `${mark}  ${String(status).padEnd(3)}  ${String(r.durationMs).padStart(6)}ms  ${r.name}`;
    return [head, ...r.failures.map((f) => `        - ${f}`)].join("\n");
  });
  const pass = results.filter((r) => r.ok && !r.skipped).length;
  const skip = results.filter((r) => r.skipped).length;
  const fail = results.length - pass - skip;
  lines.push("", `${pass} passed, ${fail} failed, ${skip} skipped`);
  return lines.join("\n");
}
