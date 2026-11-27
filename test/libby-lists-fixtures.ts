import type { LibbyTag } from "../src/libby-tags-cache.js";

// The API returns tag records and a separate { tag: { taggings } } response per tag.
export const fixtureTags: LibbyTag[] = [
  { uuid: "all", name: "📚 All" },
  { uuid: "a", name: "⭐ Favorite" },
  { uuid: "b", name: "To read" },
  { uuid: "c", name: "🎧 Audio" },
];
export const fixtureTaggings = Object.fromEntries(
  fixtureTags.map((tag) => [
    tag.uuid,
    {
      tag: {
        taggings: Array.from({ length: 8 }, (_, mask) => mask)
          .filter(
            (mask) => tag.uuid === "all" || Boolean(mask & ({ a: 1, b: 2, c: 4 } as Record<string, number>)[tag.uuid]!),
          )
          .map((mask) => ({ titleId: String(mask), sortTitle: `Book ${mask}`, sortAuthor: "Author" })),
      },
    },
  ]),
);
export const fixtureClient = {
  tags: async () => ({ tags: fixtureTags }),
  taggings: async (tag: LibbyTag) => fixtureTaggings[tag.uuid],
};
