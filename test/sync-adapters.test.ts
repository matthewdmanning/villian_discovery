import { describe, expect, it } from "vitest";
import { BookSnapshotSchema } from "../src/sync.js";
import {
  disconnectedAdapter,
  fableAdapter,
  fableSnapshots,
  libbyAdapter,
  libbySnapshots,
} from "../src/sync-adapters.js";
import { resolveSyncSettings } from "../src/sync-config.js";
import { previewSync } from "../src/sync-plan.js";

describe("libbySnapshots", () => {
  it("turns each current loan into one checked-out book", () => {
    const books = libbySnapshots({
      loans: [
        {
          id: "11",
          cardId: "1",
          title: "Dune",
          firstCreatorName: "Frank Herbert",
          formats: [{ id: "ebook-kindle", identifiers: [{ type: "ISBN", value: "9780441172719" }] }],
        },
        { id: "11", cardId: "2", title: "Dune" },
        { id: "12", cardId: "1" },
      ],
    });
    expect(books).toEqual([
      {
        bookId: "libby:11",
        title: "Dune",
        author: "Frank Herbert",
        isbn: "9780441172719",
        providerId: "11",
        fields: { checkedOut: { value: true } },
      },
    ]);
    for (const book of books) BookSnapshotSchema.parse(book);
  });
});

describe("fableSnapshots", () => {
  it("merges a book across lists and omits fields Fable did not return", () => {
    const book = {
      id: "b1",
      title: "Piranesi",
      authors: [{ name: "Susanna Clarke" }],
      isbn: "9781635575637",
      reading_progress: { current_percentage: 65, status: "currently_reading" },
      user_rating: null,
    };
    const books = fableSnapshots([
      { list: { id: "l1", name: "Favorites" }, entries: [{ book, note: null }] },
      { list: { id: "l2", name: "Book club" }, entries: [{ book, note: "Read the ending again" }, { note: "orphan" }] },
    ]);
    expect(books).toEqual([
      {
        bookId: "fable:b1",
        title: "Piranesi",
        author: "Susanna Clarke",
        isbn: "9781635575637",
        providerId: "b1",
        fields: {
          readingProgress: { value: 65 },
          readingStatus: { value: "currently-reading" },
          notes: { value: "Read the ending again" },
          shelves: { value: ["Favorites", "Book club"] },
        },
      },
    ]);
    for (const snapshot of books) BookSnapshotSchema.parse(snapshot);
  });
});

describe("live adapters", () => {
  it("stay unverified, expose no writable fields, and refuse writes", async () => {
    const adapters = [
      libbyAdapter({ sync: async () => ({}) } as never),
      fableAdapter(async () => ({ next: null, results: [] }) as never),
    ];
    for (const adapter of adapters) {
      expect(adapter.verified).toBe(false);
      expect(adapter.writableFields).toEqual([]);
      await expect(adapter.write({} as never, {} as never, async () => {})).rejects.toThrow(/not verified/);
      expect(await adapter.read({ userId: "u", connectionId: "c" })).toEqual([]);
    }
  });
});

describe("disconnectedAdapter", () => {
  it("lets a preview run with only one connected app", async () => {
    const book = { id: "b1", title: "Piranesi", reading_progress: { current_percentage: 65, status: "finished" } };
    const get = async (path: string) =>
      ({
        next: null,
        results: path === "/api/me/book-lists" ? [{ id: "l1", name: "Favorites" }] : [{ book, note: null }],
      }) as never;
    const plan = await previewSync({
      context: { userId: "u", connectionId: "c" },
      settings: resolveSyncSettings(),
      adapters: { libby: disconnectedAdapter(), fable: fableAdapter(get) },
    });
    expect(plan.schemas.libby).toEqual([]);
    expect(plan.rows.map((row) => row.title)).toContain("Piranesi");
    expect(plan.operations).toEqual([]);
  });
});
