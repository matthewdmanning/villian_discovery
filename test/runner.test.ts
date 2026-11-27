import { mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loginWithSetupCode, readTokenFile, signInToLibby, writeTokenFile } from "../src/auth.js";
import { parseConfig } from "../src/config.js";
import type { BrowserSession } from "../src/discovery/browser.js";
import { HttpError } from "../src/errors.js";
import { LibbyClient } from "../src/libby-client.js";
import { silentLogger } from "../src/logger.js";
import { Runner } from "../src/runner.js";
import { ThunderClient } from "../src/thunder-client.js";
import { card, fakeFetch, media } from "./fixtures.js";

const http = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };
const projectAuthors = [{ id: 42, name: "Andy Weir", role: "Author" }];

function setup(routes: Parameters<typeof fakeFetch>[0], cfgOver = {}) {
  const f = fakeFetch(routes);
  const cfg = parseConfig({ delayMs: 0, logLevel: "silent", ...cfgOver });
  const libby = new LibbyClient({ ...http, fetch: f.fetch, identityToken: "tok" });
  const thunder = new ThunderClient({ ...http, fetch: f.fetch });
  return { ...f, runner: new Runner(cfg, { libby, thunder, logger: silentLogger }) };
}

const syncRoute = (over: object = {}) => ({
  method: "GET",
  match: /^https:\/\/sentry\.libbyapp\.com\/chip\/sync$/,
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
          body: { upstream: { userExplanation: "Title no longer available", errorCode: "TitleNoLongerAvailable" } },
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

  it.each([false, true])(
    "previews other editions at every selected library (audiobook only: %s)",
    async (audioOnly) => {
      const isbn = "9780593135204";
      const exact = media({ creators: projectAuthors, firstCreatorName: "Ray Porter" });
      const alternative = media({
        id: "222",
        creators: projectAuthors,
        type: { id: "audiobook" },
        formats: [{ id: "audiobook-overdrive", identifiers: [{ type: "ISBN", value: "9780593395579" }] }],
      });
      const { runner, calls } = setup([
        {
          match: /thunder/,
          respond: (url) => {
            const first = url.pathname.endsWith("lib1/media");
            if (url.searchParams.has("identifier")) return { body: { items: first ? [exact] : [] } };
            const wrongAuthor = media({ id: "333", firstCreatorName: "Jane Austen", formats: [] });
            const wrongTitle = media({ ...alternative, id: "444", title: "Project Hail Mary: The Study Guide" });
            return { body: { items: first ? [exact, alternative] : [alternative, wrongAuthor, wrongTitle] } };
          },
        },
      ]);
      const cards = [card(), card({ cardId: "200", advantageKey: "lib2" })];

      const matches = await runner.searchMatches(
        { raw: isbn, isbn, ...(audioOnly && { mediaTypes: ["audiobook"] }) },
        cards,
      );

      expect(matches.map(({ card, media }) => [card.advantageKey, media.id])).toEqual([
        ...(audioOnly ? [] : [["lib1", "111"]]),
        ["lib1", "222"],
        ["lib2", "222"],
      ]);
      expect(calls.map(({ url }) => url.searchParams.get("identifier") ?? url.searchParams.get("query"))).toEqual([
        isbn,
        isbn,
        "Project Hail Mary Andy Weir",
        "Project Hail Mary Andy Weir",
      ]);
      expect(calls.every(({ method, url }) => method === "GET" && url.hostname === "thunder.api.overdrive.com")).toBe(
        true,
      );
      if (audioOnly) {
        expect(calls[0]?.url.searchParams.get("mediaTypes")).toContain("ebook");
        expect(calls[2]?.url.searchParams.get("mediaTypes")).toBe("audiobook");
      }
    },
  );

  it("searches each library once and offers every card at that library", async () => {
    const { runner, calls } = setup([{ match: /thunder/, respond: () => ({ body: { items: [media()] } }) }]);
    const cards = [
      card(),
      card({ cardId: "200", advantageKey: "lib2" }),
      card({ cardId: "300", advantageKey: "lib1" }),
    ];
    const found = await runner.findCandidates({ raw: "x", title: "Project Hail Mary", author: "Andy Weir" }, cards);
    expect(found.map(({ card }) => [card.advantageKey, card.cardId])).toEqual([
      ["lib1", "100"],
      ["lib1", "300"],
      ["lib2", "200"],
    ]);
    expect(calls.map(({ url }) => url.pathname.split("/")[3])).toEqual(["lib1", "lib2"]);
  });

  it("does not confirm cross-ISBN editions without an authoritative ISBN match", async () => {
    const isbn = "9780593135204";
    const { runner, calls } = setup([
      {
        match: /thunder/,
        respond: (url) => ({ body: { items: url.searchParams.has("query") ? [media({ formats: [] })] : [] } }),
      },
    ]);
    expect(await runner.searchMatches({ raw: isbn, isbn }, [card()])).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(await runner.searchMatches({ raw: isbn, isbn, title: "Project Hail Mary" }, [card()])).toEqual([]);
    expect(calls.every(({ url }) => url.searchParams.has("identifier"))).toBe(true);
  });

  it("keeps exact ISBN results and checks later libraries when alternate lookup fails", async () => {
    const isbn = "9780593135204";
    const { runner } = setup([
      {
        match: /thunder/,
        respond: (url) => {
          if (url.searchParams.has("identifier")) {
            return {
              body: { items: url.pathname.endsWith("lib1/media") ? [media({ creators: projectAuthors })] : [] },
            };
          }
          if (url.pathname.endsWith("lib2/media")) return { status: 503, body: { message: "Catalog unavailable" } };
          return { body: { items: [media({ id: "222", creators: projectAuthors, formats: [] })] } };
        },
      },
    ]);
    const cards = [
      card(),
      card({ cardId: "200", advantageKey: "lib2" }),
      card({ cardId: "300", advantageKey: "lib3" }),
    ];

    const matches = await runner.searchMatches({ raw: isbn, isbn }, cards);
    expect(matches.filter((match) => match.isbnMatch).map(({ media }) => media.id)).toEqual(["111"]);
    expect(matches.map(({ card, media }) => [card.advantageKey, media.id])).toEqual([
      ["lib1", "111"],
      ["lib1", "222"],
      ["lib3", "222"],
    ]);
  });

  it("uses the complete catalog author IDs and full title for Dune prequel editions", async () => {
    const isbn = "9780553897821";
    const brian = { id: 119279, name: "Brian Herbert", role: "Author" };
    const kevin = { id: 304870, name: "Kevin J. Anderson", role: "Author" };
    const exact = media({
      id: "33309",
      title: "House Atreides",
      creators: [brian, kevin],
      formats: [{ id: "ebook-overdrive", identifiers: [{ type: "ISBN", value: isbn }] }],
    });
    const audiobook = media({
      ...exact,
      id: "253024",
      title: " house  atreides ",
      creators: [kevin, { ...brian, name: "B. H." }, { id: 402650, name: "Scott Brick", role: "Narrator" }],
      type: { id: "audiobook" },
      formats: [{ id: "audiobook-overdrive", identifiers: [{ type: "ISBN", value: "9781400183616" }] }],
    });
    const lookalikes = [
      media({ ...exact, id: "other-credited-author", creators: [{ ...brian, id: 393911 }, kevin], formats: [] }),
      media({ ...exact, id: "partial-byline", creators: [brian], formats: [] }),
      media({
        ...exact,
        id: "missing-author-id",
        creators: [brian, { name: kevin.name, role: "Author" }],
        formats: [],
      }),
      media({ ...exact, id: "different-subtitle", subtitle: "The Graphic Novel", formats: [] }),
      media({ ...exact, id: "33310", title: "House Harkonnen", formats: [] }),
    ];
    const { runner } = setup([
      {
        match: /thunder/,
        respond: (url) => ({
          body: { items: url.searchParams.has("identifier") ? [exact] : [audiobook, ...lookalikes] },
        }),
      },
    ]);

    const matches = await runner.searchMatches({ raw: isbn, isbn }, [card()]);
    expect(matches.map(({ media }) => media.id)).toEqual(["33309", "253024"]);
  });

  it.each([false, true])(
    "keeps exact ISBN hits without a unique credited identity (conflict: %s)",
    async (conflict) => {
      const isbn = "9780593135204";
      const items = conflict
        ? [
            media({ creators: projectAuthors }),
            media({ id: "444", creators: [{ id: 43, name: "Another Author", role: "Author" }] }),
          ]
        : [media()];
      const { runner, calls } = setup([{ match: /thunder/, respond: () => ({ body: { items } }) }]);
      expect(await runner.searchMatches({ raw: isbn, isbn }, [card()])).toMatchObject(
        items.map(({ id }) => ({ media: { id }, isbnMatch: true })),
      );
      expect(calls).toHaveLength(1);
    },
  );
});

describe("auth", () => {
  it("browser sign-in saves the first seen Libby API token that has cards", async () => {
    const signedIn = syncRoute().respond;
    const { fetch } = fakeFetch([
      {
        match: /chip\/sync$/,
        respond: (_url, init) =>
          (init.headers as Record<string, string>).Authorization === "Bearer signed-in"
            ? signedIn()
            : { body: { cards: [] } },
      },
    ]);
    const request = (url: string, token: string) => ({
      url: () => url,
      headers: () => ({ authorization: `Bearer ${token}` }),
    });
    const page = {
      url: () => "about:blank",
      goto: async () => {},
      isClosed: () => false,
      close: async () => {},
      evaluate: async () => null,
      context: () => ({ newCDPSession: async () => ({ send: async () => {}, detach: async () => {} }) }),
    };
    const context = {
      on: (_: string, listener: (r: ReturnType<typeof request>) => void) => {
        listener(request("https://thunder.api.overdrive.com/v2/libraries", "not-libby"));
        listener(request("https://sentry.libbyapp.com/chip", "anonymous"));
        listener(request("https://vandal.libbyapp.com/tags", "signed-in"));
      },
      off: () => {},
      pages: () => [page],
    };
    const session = { context, page, isClosed: () => false } as unknown as BrowserSession;
    const tokenFile = join(await mkdtemp(join(tmpdir(), "libby-signin-")), "identity.json");
    await signInToLibby(session, { http: { ...http, fetch }, tokenFile, log: () => {} });
    expect(await readTokenFile(tokenFile)).toBe("signed-in");
  });

  it.each([
    ["an anonymous identity", '"anonymous"', 1],
    ["no identity", null, 1],
    ["a signed-in identity", '"signed-in"', 0],
  ])("browser sign-in with %s clears Libby's data %i times", async (_, initial, clears) => {
    const { fetch } = fakeFetch([
      {
        match: /chip\/sync$/,
        respond: (_url, init) =>
          (init.headers as Record<string, string>).Authorization === "Bearer anonymous"
            ? { body: { cards: [] } }
            : syncRoute().respond(),
      },
    ]);
    const cleared: unknown[] = [];
    let stored: string | null = initial;
    const page = {
      url: () => "about:blank",
      goto: async () => {},
      isClosed: () => false,
      close: async () => {},
      evaluate: async () => stored,
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string, params: unknown) => {
            cleared.push({ method, params });
            stored = '"signed-in"';
          },
          detach: async () => {},
        }),
      }),
    };
    const context = { on: () => {}, off: () => {}, pages: () => [page] };
    const session = { context, page, isClosed: () => false } as unknown as BrowserSession;
    const tokenFile = join(await mkdtemp(join(tmpdir(), "libby-reset-")), "identity.json");
    await signInToLibby(session, { http: { ...http, fetch }, tokenFile, log: () => {} });
    expect(cleared).toEqual(
      Array(clears).fill({
        method: "Storage.clearDataForOrigin",
        params: { origin: "https://libbyapp.com", storageTypes: "all" },
      }),
    );
    expect(await readTokenFile(tokenFile)).toBe("signed-in");
  });

  it("setup-code login completes approval and persists the refreshed identity", async () => {
    let acquisitions = 0;
    const { fetch, calls } = fakeFetch([
      {
        method: "POST",
        match: /\/chip\?client=dewey$/,
        respond: () => ({ body: { identity: ++acquisitions === 1 ? "anonymous" : "linked" } }),
      },
      { method: "POST", match: /chip\/clone\/code$/, respond: () => ({ body: { blessing: "approval" } }) },
      { method: "POST", match: /chip\/clone$/, respond: () => ({ body: {} }) },
      syncRoute(),
    ]);
    const client = new LibbyClient({ ...http, fetch });
    await expect(loginWithSetupCode(client, "12345678")).resolves.toBe("linked");
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/chip",
      "/chip/clone/code",
      "/chip/clone",
      "/chip",
      "/chip/sync",
    ]);
    expect(calls[1]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[2]!.body).toBe("blessing=approval");
    expect(calls[3]!.headers.Authorization).toBe("Bearer anonymous");
    expect(calls[4]!.headers.Authorization).toBe("Bearer linked");
    await expect(loginWithSetupCode(client, "123")).rejects.toThrow(/8 digits/);
    expect(acquisitions).toBe(2);
  });

  it("token file round-trips", async () => {
    const dir = await mkdtemp(join(tmpdir(), "libby-"));
    const p = join(dir, "sub", "identity.json");
    await writeTokenFile(p, "abc");
    expect(await readTokenFile(p)).toBe("abc");
    const fh = await open(p, "r");
    try {
      expect(JSON.parse(await fh.readFile("utf8")).identity).toBe("abc");
    } finally {
      await fh.close();
    }
  });

  it.skipIf(process.platform === "win32")("token file has POSIX 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "libby-mode-"));
    const p = join(dir, "identity.json");
    await writeTokenFile(p, "abc");
    const fh = await open(p, "r");
    try {
      expect((await fh.stat()).mode & 0o777).toBe(0o600);
    } finally {
      await fh.close();
    }
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
