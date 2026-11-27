import { describe, expect, it } from "vitest";
import { LibbyClient } from "../src/libby-client.js";
import { filterListItems, readLists } from "../src/libby-lists.js";
import { silentLogger } from "../src/logger.js";
import { fakeFetch } from "./fixtures.js";

const options = { timeoutMs: 1000, retries: 0, retryBaseMs: 1, userAgent: "test", logger: silentLogger };

describe("tagged lists", () => {
  it("reads tag memberships and intersects each condition", async () => {
    const client = {
      tags: async () => ({
        tags: [
          { uuid: "a", name: "A" },
          { uuid: "b", name: "B" },
          { uuid: "c", name: "C" },
        ],
      }),
      taggings: async (tag: { uuid: string }) => ({
        tag: {
          taggings: (
            {
              a: [
                { titleId: "1", sortTitle: "One" },
                { titleId: "2", sortTitle: "Two" },
              ],
              b: [{ titleId: "1" }, { titleId: "3", sortTitle: "Three" }],
              c: [{ titleId: "2" }],
            } as Record<string, unknown[]>
          )[tag.uuid],
        },
      }),
    };
    const { items } = await readLists(client);
    const ids = (includes: string[], excludes: string[]) =>
      filterListItems(items, includes, excludes).map((item) => item.id);
    expect(ids([], [])).toEqual(["1", "2", "3"]);
    expect(ids(["a", "b"], [])).toEqual(["1"]);
    expect(ids([], ["a", "c"])).toEqual(["3"]);
    expect(ids(["a"], ["b"])).toEqual(["2"]);
    expect(ids(["a"], ["a"])).toEqual([]);
  });
  it("fails if a tag's titles cannot be read", async () => {
    await expect(
      readLists({ tags: async () => ({ tags: [{ uuid: "a", name: "A" }] }), taggings: async () => ({}) }),
    ).rejects.toThrow();
  });
  it("uses Libby's encoded tag path", async () => {
    const transport = fakeFetch([{ match: /\/tag\//, respond: () => ({ body: { tag: { taggings: [] } } }) }]);
    const client = new LibbyClient({ ...options, fetch: transport.fetch, identityToken: "token" });
    await client.taggings({ uuid: "a", name: "📚" });
    expect(transport.calls[0]?.url.toString()).toContain("/tag/a/8J%2BTmg%3D%3D?enc=1");
  });
});

describe("Boolean tag groups", () => {
  it("selects every membership combination with AND, OR and both columns", async () => {
    const { fixtureClient } = await import("./libby-lists-fixtures.js");
    const { filterListGroups } = await import("../src/libby-lists.js");
    const { items } = await readLists(fixtureClient);
    const ids = (include: string[][], exclude: string[][]) =>
      filterListGroups(items, include, exclude)
        .map((item) => Number(item.id))
        .sort();
    expect(ids([], [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ids([["a", "b"]], [])).toEqual([3, 7]);
    expect(ids([["a"], ["b"]], [])).toEqual([1, 2, 3, 5, 6, 7]);
    expect(ids([], [["a", "b"]])).toEqual([0, 1, 2, 4, 5, 6]);
    expect(ids([], [["a"], ["b"]])).toEqual([0, 4]);
    expect(ids([["a", "b"], ["c"]], [["a", "c"]])).toEqual([3, 4, 6]);
    expect(ids([[]], [[]])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ids([["a"]], [["a"]])).toEqual([]);
  });
});
