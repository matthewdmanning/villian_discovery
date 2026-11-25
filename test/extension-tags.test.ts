import { describe, expect, it } from "vitest";
import {
  cachedTagsForAccount,
  libbyAccountKey,
  parseTagsResponse,
  storeTagsForAccount,
} from "../src/libby-tags-cache.js";

describe("Libby tag response validation", () => {
  it("keeps known and unknown tag fields", () => {
    const extra = { behaviors: ["shelf"], futureField: { enabled: true } };
    expect(parseTagsResponse({ tags: [{ name: "To read", uuid: "tag-1", description: "Later", ...extra }] })).toEqual([
      { name: "To read", uuid: "tag-1", description: "Later", ...extra },
    ]);
  });

  it("rejects malformed untrusted tag data", () => {
    expect(() => parseTagsResponse({ tags: [{ name: "Missing id" }] })).toThrow("invalid tag");
    expect(() => parseTagsResponse({ tags: "not an array" })).toThrow("valid tags list");
  });

  it("keeps tag storage isolated by stable card identities", () => {
    const first = libbyAccountKey([{ cardId: "card-a", advantageKey: "library-a" }]);
    const second = libbyAccountKey([{ cardId: "card-b", advantageKey: "library-b" }]);
    const stored = storeTagsForAccount({}, first, [{ name: "First", uuid: "tag-1" }]);

    expect(cachedTagsForAccount(stored, first)).toEqual([{ name: "First", uuid: "tag-1" }]);
    expect(cachedTagsForAccount(stored, second)).toBeUndefined();
    expect(libbyAccountKey([{ cardId: "card-a", advantageKey: "library-a" }])).toBe(first);
    expect(storeTagsForAccount([{ name: "legacy", uuid: "old" }], first, [{ name: "First", uuid: "tag-1" }])).toEqual({
      [first]: [{ name: "First", uuid: "tag-1" }],
    });
  });
});
