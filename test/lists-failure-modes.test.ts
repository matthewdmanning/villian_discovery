import { describe, expect, it } from "vitest";
import { LibbyClient } from "../src/libby-client.js";
import { listLibraryAvailability } from "../src/libby-list-availability.js";
import { filterListQueries, listQueryKey, readLists } from "../src/libby-lists.js";
import { silentLogger } from "../src/logger.js";
import { ThunderClient } from "../src/thunder-client.js";
import { card, fakeFetch, media } from "./fixtures.js";

const options = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };

describe("tagged-list failure modes", () => {
  it("does not return an incomplete list when one tag request fails", async () => {
    const transport = fakeFetch([
      {
        match: /\/tags$/,
        respond: () => ({
          body: {
            tags: [
              { uuid: "a", name: "First" },
              { uuid: "b", name: "Second" },
            ],
          },
        }),
      },
      { match: /\/tag\/a\//, respond: () => ({ body: { tag: { taggings: [{ titleId: "1", sortTitle: "Book" }] } } }) },
      { match: /\/tag\/b\//, respond: () => ({ status: 503, body: { message: "unavailable" } }) },
    ]);
    const client = new LibbyClient({ ...options, fetch: transport.fetch, identityToken: "identity" });
    await expect(readLists(client)).rejects.toThrow("503");
    expect(transport.calls).toHaveLength(3);
  });

  it("keeps memberships associated with the right tag when requests finish out of order", async () => {
    let finishFirst: ((value: unknown) => void) | undefined;
    const first = new Promise<unknown>((resolve) => {
      finishFirst = resolve;
    });
    const result = readLists({
      tags: async () => ({
        tags: [
          { uuid: "a", name: "First" },
          { uuid: "b", name: "Second" },
        ],
      }),
      taggings: async (tag) =>
        tag.uuid === "a" ? first : { tag: { taggings: [{ titleId: "b-title", sortTitle: "Second book" }] } },
    });
    await Promise.resolve();
    finishFirst?.({ tag: { taggings: [{ titleId: "a-title", sortTitle: "First book" }] } });
    const { items } = await result;
    expect(items).toEqual([
      { id: "a-title", title: "First book", tags: ["a"] },
      { id: "b-title", title: "Second book", tags: ["b"] },
    ]);
  });

  it("does not discard a later matching duplicate just because an earlier copy failed the filter", () => {
    const items = [
      { id: "1", title: "First version", tags: ["a"] },
      { id: "1", title: "Matching version", tags: ["b"] },
      { id: "1", title: "Another matching version", tags: ["b"] },
    ];
    expect(filterListQueries(items, [{ includes: [["b"]], excludes: [] }])).toEqual([items[1]]);
  });

  it("does not confuse tag IDs containing separators or include and exclude positions", () => {
    const first = { includes: [["a,b", "c"]], excludes: [["d"]] };
    expect(listQueryKey(first)).not.toBe(listQueryKey({ includes: [["a", "b,c"]], excludes: [["d"]] }));
    expect(listQueryKey(first)).not.toBe(listQueryKey({ includes: [["d"]], excludes: [["a,b", "c"]] }));
  });
});

describe("library availability failures", () => {
  it("keeps other libraries visible when a catalog says not owned or fails", async () => {
    const cards = [
      card({ cardId: "1", advantageKey: "first" }),
      card({ cardId: "2", advantageKey: "second" }),
      card({ cardId: "3", advantageKey: "third" }),
    ];
    const transport = fakeFetch([
      {
        match: /\/libraries\/first\/media\/42\?/,
        respond: () => ({ body: media({ id: "42", isOwned: true, isAvailable: true, availableCopies: 2 }) }),
      },
      { match: /\/libraries\/second\/media\/42\?/, respond: () => ({ body: media({ id: "42", isOwned: false }) }) },
      { match: /\/libraries\/third\/media\/42\?/, respond: () => ({ status: 403, body: { message: "forbidden" } }) },
    ]);
    const result = await listLibraryAvailability(
      "42",
      { sync: async () => ({ cards }) },
      new ThunderClient({ ...options, fetch: transport.fetch }),
    );
    expect(result.map(({ card: item, status }) => [item.cardId, status])).toEqual([
      ["1", "ok"],
      ["2", "not-offered"],
      ["3", "error"],
    ]);
    expect(result[0]?.media?.availableCopies).toBe(2);
    expect(result[2]?.media).toBeUndefined();
  });

  it("returns no library rows without sending catalog requests when there are no cards", async () => {
    const transport = fakeFetch([]);
    const result = await listLibraryAvailability(
      "42",
      { sync: async () => ({ cards: [] }) },
      new ThunderClient({ ...options, fetch: transport.fetch }),
    );
    expect(result).toEqual([]);
    expect(transport.calls).toHaveLength(0);
  });
});
