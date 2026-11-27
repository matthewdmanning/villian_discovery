import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors.js";
import { LibbyClient } from "../src/libby-client.js";
import { createCardCache, listLibraryAvailability } from "../src/libby-list-availability.js";
import { filterListGroups, mapLimit, readLists, TAG_CONCURRENCY } from "../src/libby-lists.js";
import { silentLogger } from "../src/logger.js";
import { fakeFetch } from "./fixtures.js";

const options = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };
const tag = (uuid: string, name = uuid) => ({ uuid, name });
const listsFor = (taggings: Record<string, unknown[]>, tags = Object.keys(taggings).map((uuid) => tag(uuid))) =>
  readLists({
    tags: async () => ({ tags }),
    taggings: async ({ uuid }) => ({ tag: { taggings: taggings[uuid] } }),
  });

describe("readLists from real Libby response shapes", () => {
  it("merges a title that appears in several tags into one item", async () => {
    const { items } = await listsFor({
      a: [{ titleId: "1", sortTitle: "Dune", sortAuthor: "Herbert" }],
      b: [{ titleId: "1", sortTitle: "Dune", sortAuthor: "Herbert" }],
    });
    expect(items).toEqual([{ id: "1", title: "Dune", author: "Herbert", tags: ["a", "b"] }]);
  });

  it("accepts numeric title IDs and names a title that has no title", async () => {
    const { items } = await listsFor({ a: [{ titleId: 42 }, { titleId: "43", sortTitle: "   ", sortAuthor: "  " }] });
    expect(items).toEqual([
      { id: "42", title: "Title 42", tags: ["a"] },
      { id: "43", title: "Title 43", tags: ["a"] },
    ]);
  });

  it("returns no items for no tags and for tags nobody has used", async () => {
    expect(await listsFor({}, [])).toEqual({ tags: [], items: [] });
    expect((await listsFor({ a: [] })).items).toEqual([]);
  });

  it("rejects a tag whose titles are malformed, naming the tag", async () => {
    await expect(listsFor({ a: [{ sortTitle: "No ID" }] }, [tag("a", "Favorites")])).rejects.toThrow(
      "Could not read titles for Favorites",
    );
    await expect(listsFor({ a: ["not an object"] }, [tag("a", "Favorites")])).rejects.toThrow("Favorites");
    await expect(
      readLists({ tags: async () => ({ tags: [tag("a", "Favorites")] }), taggings: async () => ({ tag: {} }) }),
    ).rejects.toThrow("Could not read titles for Favorites");
  });

  it("rejects an invalid tags response before asking for any titles", async () => {
    let asked = false;
    await expect(
      readLists({
        tags: async () => ({ tags: [{ name: "No uuid" }] }),
        taggings: async () => {
          asked = true;
          return {};
        },
      }),
    ).rejects.toThrow("invalid tag");
    expect(asked).toBe(false);
  });

  it("propagates a failure reading the tag list", async () => {
    await expect(
      readLists({
        tags: async () => {
          throw new Error("offline");
        },
        taggings: async () => ({}),
      }),
    ).rejects.toThrow("offline");
  });
});

describe("LibbyClient.taggings path", () => {
  const pathFor = async (name: string) => {
    const transport = fakeFetch([{ match: /\/tag\//, respond: () => ({ body: { tag: { taggings: [] } } }) }]);
    const client = new LibbyClient({ ...options, fetch: transport.fetch, identityToken: "token" });
    await client.taggings({ uuid: "u/1", name });
    return transport.calls[0]!.url;
  };

  it("percent-encodes the tag ID and base64 characters that are unsafe in a path", async () => {
    // "???" encodes to "Pz8/" and ">>>" to "Pj4+": both contain path-unsafe base64 characters.
    expect((await pathFor("???")).toString()).toContain("/tag/u%2F1/Pz8%2F?enc=1");
    expect((await pathFor(">>>")).toString()).toContain("/tag/u%2F1/Pj4%2B?enc=1");
  });

  it("encodes the tag name as UTF-8, not Latin-1", async () => {
    const url = await pathFor("Café ☕");
    const segment = decodeURIComponent(url.pathname.split("/").at(-1)!);
    expect(Buffer.from(segment, "base64").toString("utf8")).toBe("Café ☕");
  });
});

describe("filterListGroups", () => {
  const items = [
    { id: "1", title: "One", tags: ["a"] },
    { id: "2", title: "Two", tags: ["b"] },
    { id: "3", title: "Three", tags: [] },
  ];
  it("excludes without requiring an include, and keeps untagged titles", () => {
    expect(filterListGroups(items, [], [["a"]]).map((item) => item.id)).toEqual(["2", "3"]);
    expect(filterListGroups(items, [[]], [[], ["b"]]).map((item) => item.id)).toEqual(["1", "3"]);
  });
});

describe("listLibraryAvailability input and catalog edge cases", () => {
  const cards = [{ cardId: "1", advantageKey: "first" }];
  const ok = { sync: async () => ({ cards }) };

  it("rejects a title ID that is blank, not a string, or too long", async () => {
    const catalog = { getLibraryMedia: async () => ({ id: "1", title: "A" }) };
    for (const id of ["", "   ", "x".repeat(201), undefined as unknown as string, 5 as unknown as string]) {
      await expect(listLibraryAvailability(id, ok, catalog)).rejects.toThrow("Invalid title ID");
    }
    await expect(listLibraryAvailability("x".repeat(200), ok, catalog)).resolves.toHaveLength(1);
  });

  it("asks each card's own library for the requested title", async () => {
    const asked: string[][] = [];
    await listLibraryAvailability(
      "42",
      {
        sync: async () => ({
          cards: [
            { cardId: "1", advantageKey: "first" },
            { cardId: "2", advantageKey: "second" },
          ],
        }),
      },
      {
        getLibraryMedia: async (library, id) => {
          asked.push([library, id]);
          return { id, title: "A" };
        },
      },
    );
    expect(asked.sort()).toEqual([
      ["first", "42"],
      ["second", "42"],
    ]);
  });

  it("keeps the catalog entry for a title the library lists but does not own", async () => {
    const [row] = await listLibraryAvailability("42", ok, {
      getLibraryMedia: async (_library, id) => ({ id, title: "A", isOwned: false }),
    });
    expect(row?.status).toBe("not-offered");
    expect(row?.media?.id).toBe("42");
  });

  it("treats only a 404 as not offered; other HTTP errors are failures", async () => {
    for (const [status, expected] of [
      [404, "not-offered"],
      [429, "error"],
      [500, "error"],
    ] as const) {
      const [row] = await listLibraryAvailability("42", ok, {
        getLibraryMedia: async () => {
          throw new HttpError("failed", status, "", {});
        },
      });
      expect(row?.status).toBe(expected);
    }
  });

  it("treats a catalog entry without isOwned as offered", async () => {
    const [row] = await listLibraryAvailability("42", ok, { getLibraryMedia: async (_l, id) => ({ id, title: "A" }) });
    expect(row?.status).toBe("ok");
  });

  it("returns no rows when the account has no cards", async () => {
    expect(
      await listLibraryAvailability(
        "42",
        { sync: async () => ({}) },
        { getLibraryMedia: async () => ({ id: "1", title: "A" }) },
      ),
    ).toEqual([]);
  });
});

describe("tag request concurrency", () => {
  it("readLists keeps at most TAG_CONCURRENCY tag requests in flight, in tag order", async () => {
    let inFlight = 0;
    let peak = 0;
    const tags = Array.from({ length: 10 }, (_, i) => tag(`t${i}`));
    const data = await readLists({
      tags: async () => ({ tags }),
      taggings: async ({ uuid }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return { tag: { taggings: [{ titleId: uuid, sortTitle: uuid }] } };
      },
    });
    expect(peak).toBe(TAG_CONCURRENCY);
    expect(data.items.map((item) => item.id)).toEqual(tags.map((t) => t.uuid));
  });

  it("mapLimit stops starting calls after the first failure", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 1) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
  });
});

describe("card cache", () => {
  it("reuses one card list per token until it expires", async () => {
    let time = 0;
    let loads = 0;
    const cache = createCardCache(1000, () => time);
    const load = async () => ({ cards: [{ cardId: String(++loads) }] as never });
    await cache("a", load);
    await cache("a", load);
    expect(loads).toBe(1);
    await cache("b", load);
    expect(loads).toBe(2);
    time = 5000;
    await cache("b", load);
    expect(loads).toBe(3);
  });

  it("does not remember a failed load", async () => {
    const cache = createCardCache(1000, () => 0);
    await expect(cache("a", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(cache("a", async () => ({ cards: [] }))).resolves.toEqual({ cards: [] });
  });
});
