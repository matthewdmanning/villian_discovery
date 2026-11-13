import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSite,
  formatResults,
  loadSiteTestConfig,
  parseSiteTestConfig,
  runSiteChecks,
  type SiteTestConfig,
  statusMatches,
} from "../src/discovery/site-check.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Routes map url → handler; a plain Response is served as a fresh copy per call. */
function fakeFetch(routes: Record<string, Handler | Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const r = routes[url];
    if (!r) throw new TypeError("fetch failed", { cause: new Error("ENOTFOUND") });
    return typeof r === "function" ? r(url, init) : r.clone();
  }) as typeof fetch;
  return { fetch: f, calls };
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cfg = (over: Partial<SiteTestConfig> = {}): SiteTestConfig =>
  parseSiteTestConfig({ sites: [{ url: "https://a.test/" }], ...over });

describe("parseSiteTestConfig", () => {
  it("rejects unknown keys, bad urls and bad status specs", () => {
    expect(() => parseSiteTestConfig({ sites: [{ url: "https://a.test/", bogus: 1 }] })).toThrow();
    expect(() => parseSiteTestConfig({ sites: [{ url: "ftp://a.test/" }] })).toThrow();
    expect(() => parseSiteTestConfig({ sites: [{ url: "https://a.test/", expectStatus: ["2x"] }] })).toThrow();
    expect(() => parseSiteTestConfig({ sites: [] })).toThrow();
  });

  it("parses the shipped example", async () => {
    const { config } = await loadSiteTestConfig("examples/site-tests.json");
    expect(config.sites.length).toBeGreaterThan(0);
  });
});

describe("statusMatches", () => {
  it("supports exact, class and range specs", () => {
    expect(statusMatches(204, [204])).toBe(true);
    expect(statusMatches(404, ["4xx"])).toBe(true);
    expect(statusMatches(302, ["200-399"])).toBe(true);
    expect(statusMatches(500, [200, "2xx", "300-399"])).toBe(false);
  });
});

describe("checkSite", () => {
  it("passes a default check and names the site by host", async () => {
    const { fetch } = fakeFetch({ "https://a.test/": html("hi") });
    const c = cfg();
    const r = await checkSite(c.sites[0]!, c, { fetch });
    expect(r).toMatchObject({ name: "a.test", ok: true, status: 200, failures: [] });
  });

  it("reports status, content type and body failures", async () => {
    const { fetch } = fakeFetch({ "https://a.test/": html("nope", 500) });
    const c = cfg({
      sites: [{ url: "https://a.test/", expectContentType: "json", expectBodyIncludes: ["Welcome"] }],
    });
    const r = await checkSite(c.sites[0]!, c, { fetch });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([
      "status 500 not in [200-399]",
      "content-type text/html lacks json",
      'body lacks "Welcome"',
    ]);
  });

  it("reports network errors with their cause", async () => {
    const { fetch } = fakeFetch({});
    const c = cfg();
    const r = await checkSite(c.sites[0]!, c, { fetch });
    expect(r).toMatchObject({ ok: false, error: "fetch failed: ENOTFOUND" });
    expect(r.status).toBeUndefined();
  });

  it("validates JSON bodies against inline and file schemas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "site-check-"));
    await writeFile(join(dir, "s.json"), JSON.stringify({ type: "object", required: ["id"] }));
    const { fetch } = fakeFetch({ "https://a.test/": json({ name: 1 }) });
    const c = cfg({
      sites: [
        { name: "inline", url: "https://a.test/", expectSchema: { type: "array" } },
        { name: "file", url: "https://a.test/", expectSchema: "s.json" },
      ],
    });
    const [inline, file] = await runSiteChecks(c, { fetch, baseDir: dir });
    expect(inline!.failures).toEqual(["schema /: expected array, got object"]);
    expect(file!.failures).toEqual(["schema /id: required property missing"]);
  });

  it("flags non-JSON bodies when a schema is expected", async () => {
    const { fetch } = fakeFetch({ "https://a.test/": html("<p>") });
    const c = cfg({ sites: [{ url: "https://a.test/", expectSchema: { type: "object" } }] });
    expect((await checkSite(c.sites[0]!, c, { fetch })).failures).toEqual(["body is not JSON"]);
  });

  it("merges defaults with per-site overrides and sends JSON bodies", async () => {
    const { fetch, calls } = fakeFetch({ "https://a.test/": json({}, 201) });
    const c = cfg({
      defaults: { headers: { "x-a": "1" }, expectStatus: [200] },
      sites: [{ url: "https://a.test/", method: "POST", body: { q: 1 }, headers: { "x-b": "2" }, expectStatus: [201] }],
    });
    const r = await checkSite(c.sites[0]!, c, { fetch });
    expect(r.ok).toBe(true);
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      body: '{"q":1}',
      headers: { "x-a": "1", "x-b": "2", "content-type": "application/json" },
    });
  });

  it("enforces maxDurationMs", async () => {
    let t = 0;
    const { fetch } = fakeFetch({ "https://a.test/": html("") });
    const c = cfg({ sites: [{ url: "https://a.test/", maxDurationMs: 100 }] });
    const r = await checkSite(c.sites[0]!, c, { fetch, now: () => (t += 150) });
    expect(r.failures).toEqual(["took 150ms > 100ms"]);
  });
});

describe("runSiteChecks", () => {
  const c = parseSiteTestConfig({
    concurrency: 2,
    sites: [
      { name: "one", url: "https://a.test/", tags: ["smoke"] },
      { name: "two", url: "https://b.test/" },
      { name: "three", url: "https://c.test/", skip: true },
    ],
  });
  const { fetch } = fakeFetch({ "https://a.test/": html(""), "https://b.test/": html("", 404) });

  it("keeps config order and counts skips", async () => {
    const results = await runSiteChecks(c, { fetch });
    expect(results.map((r) => [r.name, r.ok, r.skipped ?? false])).toEqual([
      ["one", true, false],
      ["two", false, false],
      ["three", true, true],
    ]);
    expect(formatResults(results)).toContain("1 passed, 1 failed, 1 skipped");
  });

  it("filters by name or tag", async () => {
    expect((await runSiteChecks(c, { fetch, only: ["smoke"] })).map((r) => r.name)).toEqual(["one"]);
    expect((await runSiteChecks(c, { fetch, only: ["two"] })).map((r) => r.name)).toEqual(["two"]);
  });
});
