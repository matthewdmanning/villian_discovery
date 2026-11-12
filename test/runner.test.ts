import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loginWithSetupCode, readTokenFile, writeTokenFile } from "../src/auth.js";
import { parseConfig } from "../src/config.js";
import { HttpError } from "../src/errors.js";
import { LibbyClient } from "../src/libby-client.js";
import { silentLogger } from "../src/logger.js";
import { Runner } from "../src/runner.js";
import { ThunderClient } from "../src/thunder-client.js";
import { card, fakeFetch, media } from "./fixtures.js";

const http = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };

function setup(routes: Parameters<typeof fakeFetch>[0], cfgOver = {}) {
  const f = fakeFetch(routes);
  const cfg = parseConfig({ delayMs: 0, logLevel: "silent", ...cfgOver });
  const libby = new LibbyClient({ ...http, fetch: f.fetch, identityToken: "tok" });
  const thunder = new ThunderClient({ ...http, fetch: f.fetch });
  return { ...f, runner: new Runner(cfg, { libby, thunder, logger: silentLogger }) };
}

const syncRoute = (over: object = {}) => ({
  method: "GET",
  match: /sentry-read\.svc\.overdrive\.com\/chip\/sync/,
  respond: () => ({
    body: {
      result: "synchronized",
      cards: [card(), card({ cardId: "200", advantageKey: "lib2" })],
      loans: [],
      holds: [],
      ...over,
    },
  }),
});

describe("Runner", () => {
  it("borrows when available and sends Libby's loan payload", async () => {
    const { runner, calls } = setup([
      syncRoute(),
      {
        match: /thunder.*libraries\/lib1\/media/,
        respond: () => ({ body: { items: [media({ isAvailable: true })] } }),
      },
      { match: /thunder.*libraries\/lib2\/media/, respond: () => ({ body: { items: [] } }) },
      { method: "POST", match: /card\/100\/loan\/111$/, respond: () => ({ body: { id: "111" } }) },
    ]);
    const res = await runner.run([
      { raw: "Project Hail Mary by Andy Weir", title: "Project Hail Mary", author: "Andy Weir" },
    ]);
    expect(res).toMatchObject([{ status: "borrowed", library: "lib1", loanDays: 14, titleId: "111" }]);
    const loan = calls.find((c) => c.method === "POST")!;
    expect(loan.body).toEqual({ period: 14, units: "days", lucky_day: null, title_format: "ebook" });
    expect(loan.headers.Authorization).toBe("Bearer tok");
    const search = calls.find((c) => c.url.pathname.endsWith("lib1/media"))!;
    expect(search.url.searchParams.get("query")).toBe("Project Hail Mary Andy Weir");
    expect(search.url.searchParams.get("mediaTypes")).toBe("ebook,audiobook");
    expect(search.url.searchParams.get("x-client-id")).toBe("dewey");
  });

  it("places and suspends a hold when nothing is available", async () => {
    const { runner, calls } = setup(
      [
        syncRoute(),
        { match: /thunder.*libraries\/lib\d\/media/, respond: () => ({ body: { items: [media()] } }) },
        { method: "POST", match: /card\/\d+\/hold\/111$/, respond: () => ({ body: {} }) },
        { method: "PUT", match: /card\/\d+\/hold\/111$/, respond: () => ({ body: {} }) },
      ],
      { hold: { suspendDays: 14, placement: "first" } },
    );
    const res = await runner.run([{ raw: "x", title: "Project Hail Mary" }]);
    expect(res).toMatchObject([{ status: "held", cardId: "100", message: "suspended 14 days" }]);
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ days_to_suspend: 0, email_address: "" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ days_to_suspend: 14 });
  });

  it("dry run never writes", async () => {
    const { runner, calls } = setup(
      [syncRoute(), { match: /thunder/, respond: () => ({ body: { items: [media({ isAvailable: true })] } }) }],
      { dryRun: true },
    );
    const res = await runner.run([{ raw: "x", title: "Project Hail Mary" }]);
    expect(res[0]!.status).toBe("would-borrow");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("falls back to hold when borrow fails in auto mode", async () => {
    const { runner } = setup([
      syncRoute(),
      { match: /thunder.*lib1/, respond: () => ({ body: { items: [media({ isAvailable: true })] } }) },
      { match: /thunder.*lib2/, respond: () => ({ body: { items: [] } }) },
      {
        method: "POST",
        match: /loan/,
        respond: () => ({
          status: 400,
          body: { upstream: { userExplanation: "Title no longer available", errorCode: "X" } },
        }),
      },
      { method: "POST", match: /hold/, respond: () => ({ body: {} }) },
    ]);
    const res = await runner.run([{ raw: "x", title: "Project Hail Mary" }]);
    expect(res).toMatchObject([{ status: "held" }]);
  });

  it("records per-book errors and continues; aborts on auth errors", async () => {
    const { runner } = setup([
      syncRoute(),
      { match: /thunder.*query=Bad/, respond: () => ({ status: 400, body: { message: "bad query" } }) },
      { match: /thunder/, respond: () => ({ body: { items: [] } }) },
    ]);
    const res = await runner.run([
      { raw: "Bad", title: "Bad" },
      { raw: "Missing", title: "Missing" },
    ]);
    expect(res.map((r) => r.status)).toEqual(["error", "skipped"]);
    expect(res[0]!.message).toMatch(/HTTP 400 - bad query/);

    const auth = setup([{ match: /sync/, respond: () => ({ status: 401, body: {} }) }]);
    await expect(auth.runner.run([{ raw: "x", title: "x" }])).rejects.toBeInstanceOf(HttpError);
  });

  it("filters and orders cards by configured libraries", async () => {
    const { runner, calls } = setup([syncRoute(), { match: /thunder/, respond: () => ({ body: { items: [] } }) }], {
      libraries: ["lib2"],
    });
    await runner.run([{ raw: "x", title: "x" }]);
    expect(calls.filter((c) => c.url.host.startsWith("thunder")).map((c) => c.url.pathname)).toEqual([
      "/v2/libraries/lib2/media",
    ]);
  });

  it("uses ISBN identifier search, then title fallback", async () => {
    const { runner, calls } = setup([syncRoute(), { match: /thunder/, respond: () => ({ body: { items: [] } }) }], {
      libraries: ["lib1"],
    });
    await runner.run([{ raw: "x", title: "Dune", isbn: "9780441013593" }]);
    const qs = calls.filter((c) => c.url.host.startsWith("thunder")).map((c) => c.url.searchParams);
    expect(qs[0]!.get("identifier")).toBe("9780441013593");
    expect(qs[1]!.get("query")).toBe("Dune");
  });
});

describe("auth", () => {
  it("setup-code login: chip, clone, sync", async () => {
    const { fetch, calls } = fakeFetch([
      { method: "POST", match: /\/chip\?client=dewey$/, respond: () => ({ body: { identity: "new-token" } }) },
      { method: "POST", match: /chip\/clone\/code/, respond: () => ({ body: { result: "cloned" } }) },
      syncRoute(),
    ]);
    const client = new LibbyClient({ ...http, fetch });
    await expect(loginWithSetupCode(client, "12345678")).resolves.toBe("new-token");
    const clone = calls[1]!;
    expect(clone.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[2]!.headers.Authorization).toBe("Bearer new-token");
    await expect(loginWithSetupCode(client, "123")).rejects.toThrow(/8 digits/);
  });

  it("token file round-trips with 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "libby-"));
    const p = join(dir, "sub", "identity.json");
    await writeTokenFile(p, "abc");
    expect(await readTokenFile(p)).toBe("abc");
    expect((await stat(p)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(p, "utf8")).identity).toBe("abc");
  });
});

describe("http retries", () => {
  it("retries 5xx then succeeds", async () => {
    let n = 0;
    const { fetch } = fakeFetch([
      { match: /sync/, respond: () => (++n < 3 ? { status: 503 } : { body: { cards: [] } }) },
    ]);
    const client = new LibbyClient({ ...http, retries: 2, fetch, identityToken: "t" });
    await expect(client.sync()).resolves.toEqual({ cards: [] });
    expect(n).toBe(3);
  });
});
