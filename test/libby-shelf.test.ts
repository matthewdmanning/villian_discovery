import { describe, expect, it } from "vitest";
import { listShelf, type ShelfTab } from "../src/libby-shelf.js";

/** Use this function to read available shelf rows in assertions without weakening the unavailable-state contract. */
const itemsOf = (tab: ShelfTab) => (tab.status === "available" ? tab.items : []);

describe("listShelf", () => {
  it("exposes current loans and holds and does not invent returned titles", async () => {
    const shelf = await listShelf({
      sync: async () => ({
        cards: [{ cardId: "card-1", cardName: "Main", advantageKey: "library" }],
        loans: [{ id: "loan-1", cardId: "card-1", title: "Loan", type: { id: "audiobook" } }],
        holds: [{ id: "hold-1", cardId: "card-1", title: "Hold", holdListPosition: 3 }],
      }),
    } as never);

    expect(shelf.checkedOut).toEqual({
      status: "available",
      items: [{ id: "loan-1", cardId: "card-1", title: "Loan", cardName: "Main", mediaType: "audiobook" }],
    });
    expect(shelf.holds).toEqual({
      status: "available",
      items: [{ id: "hold-1", cardId: "card-1", title: "Hold", cardName: "Main", holdListPosition: 3 }],
    });
    expect(shelf.returned.status).toBe("unavailable");
  });

  it("does not treat missing loan or hold arrays as empty shelves", async () => {
    const shelf = await listShelf({ sync: async () => ({}) } as never);
    const malformed = await listShelf({ sync: async () => ({ loans: {}, holds: "not-a-list" }) } as never);

    expect(shelf.checkedOut).toEqual({ status: "unavailable", reason: "Libby did not provide checked-out data." });
    expect(shelf.holds).toEqual({ status: "unavailable", reason: "Libby did not provide holds data." });
    expect(malformed.checkedOut.status).toBe("unavailable");
    expect(malformed.holds.status).toBe("unavailable");
  });

  it("uses explicit narrator credits and public catalog fallback only for audiobook rows", async () => {
    const calls: string[] = [];
    const shelf = await listShelf(
      {
        sync: async () => ({
          cards: [{ cardId: "card-2", cardName: "Main", advantageKey: "library-2" }],
          loans: [
            { id: "audio-2", cardId: "card-2", title: "Audio", type: { id: "audiobook" } },
            {
              id: "ebook-2",
              cardId: "card-2",
              title: "Ebook",
              type: { id: "ebook" },
              creators: [
                { name: "Book Author", role: "Author" },
                { name: "Audio-only credit", role: "Narrator" },
              ],
            },
          ],
          holds: [
            {
              id: "audio-3",
              cardId: "card-2",
              title: "Explicit Audio",
              type: { id: "audiobook" },
              creators: [{ name: "Ian Holm", role: "Narrator" }],
            },
          ],
        }),
      } as never,
      {
        getLibraryMedia: async (library: string, id: string) => {
          calls.push(`${library}:${id}`);
          return { id, title: "Audio", creators: [{ name: "Catalog Voice", role: "Narrator" }] };
        },
      } as never,
    );

    expect(itemsOf(shelf.checkedOut)).toEqual([
      {
        id: "audio-2",
        cardId: "card-2",
        title: "Audio",
        narrators: ["Catalog Voice"],
        cardName: "Main",
        mediaType: "audiobook",
      },
      {
        id: "ebook-2",
        cardId: "card-2",
        title: "Ebook",
        author: "Book Author",
        cardName: "Main",
        mediaType: "ebook",
      },
    ]);
    expect(itemsOf(shelf.holds)[0]).toMatchObject({ narrators: ["Ian Holm"] });
    expect(calls).toEqual(["library-2:audio-2"]);
  });

  it("keeps shelf data when public narrator metadata fails", async () => {
    const shelf = await listShelf(
      {
        sync: async () => ({
          cards: [{ cardId: "card-3", advantageKey: "library-3" }],
          loans: [{ id: "audio-4", cardId: "card-3", title: "Audio", type: { id: "audiobook" } }],
          holds: [],
        }),
      } as never,
      { getLibraryMedia: async () => Promise.reject(new Error("catalog down")) } as never,
    );

    expect(itemsOf(shelf.checkedOut)).toEqual([
      { id: "audio-4", cardId: "card-3", title: "Audio", cardName: "card-3", mediaType: "audiobook" },
    ]);
  });
});
