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
import { applySync, createMemoryJournal, previewSync } from "../src/sync-plan.js";

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

  it("adds reading progress only for loans whose position is known", () => {
    const books = libbySnapshots(
      {
        loans: [
          { id: "11", cardId: "1", title: "Dune" },
          { id: "12", cardId: "1", title: "Emma" },
        ],
      },
      new Map([["11", 1.82]]),
    );
    expect(books.map((book) => book.fields.readingProgress)).toEqual([{ value: 1.82 }, undefined]);
    for (const book of books) BookSnapshotSchema.parse(book);
  });
});

describe("duplicate loans across cards", () => {
  it("fills missing details from the other card's loan instead of adding a book", () => {
    const books = libbySnapshots({
      loans: [
        { id: "11", cardId: "1", title: "Dune" },
        {
          id: "11",
          cardId: "2",
          title: "Dune",
          firstCreatorName: "Frank Herbert",
          formats: [{ id: "ebook-kindle", identifiers: [{ type: "ISBN", value: "9780441172719" }] }],
        },
      ],
    });
    expect(books).toMatchObject([{ bookId: "libby:11", author: "Frank Herbert", isbn: "9780441172719" }]);
    expect(books).toHaveLength(1);
  });

  it("keeps the furthest progress whichever card answers last", async () => {
    for (const slowCard of ["1", "2"]) {
      const adapter = libbyAdapter({
        sync: async () => ({
          loans: [
            { id: "11", cardId: "1", title: "Dune", type: { id: "audiobook" } },
            { id: "11", cardId: "2", title: "Dune", type: { id: "audiobook" } },
          ],
        }),
        loanProgress: async ({ cardId }: { cardId: string }) => {
          if (cardId === slowCard) await new Promise((resolve) => setTimeout(resolve, 5));
          return cardId === "1" ? 30 : 70;
        },
      } as never);
      const [book] = await adapter.read({ userId: "u", connectionId: "c" });
      expect(book?.fields.readingProgress).toEqual({ value: 70 });
    }
  });
});

describe("fableSnapshots", () => {
  it("names each shelf once and picks the furthest status in any list order", () => {
    const book = { id: "b1", title: "Piranesi" };
    const lists = [
      { list: { id: "l1", name: "Finished", system_type: "finished" }, entries: [{ book, note: null }] },
      {
        list: { id: "l2", name: "Want to Read", system_type: "want_to_read" },
        entries: [
          { book, note: null },
          { book, note: null },
        ],
      },
    ];
    for (const order of [lists, [...lists].reverse()]) {
      const [snapshot] = fableSnapshots(order);
      expect(snapshot?.fields.readingStatus).toEqual({ value: "finished" });
      expect([...((snapshot?.fields.shelves?.value ?? []) as string[])].sort()).toEqual(["Finished", "Want to Read"]);
    }
  });

  it("merges a book across lists and omits fields Fable did not return", () => {
    const book = {
      id: "b1",
      title: "Piranesi",
      authors: [{ name: "Susanna Clarke" }],
      isbn: "9781635575637",
      // Live Fable data: a book on the Currently Reading list still reports "unread".
      reading_progress: { current_percentage: 65, status: "unread" },
      user_rating: null,
    };
    const books = fableSnapshots([
      { list: { id: "l1", name: "Favorites", system_type: null }, entries: [{ book, note: null }] },
      {
        list: { id: "l2", name: "Currently Reading", system_type: "current_reading" },
        entries: [{ book, note: "Read the ending again" }, { note: "orphan" }],
      },
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
          shelves: { value: ["Favorites", "Currently Reading"] },
        },
      },
    ]);
    for (const snapshot of books) BookSnapshotSchema.parse(snapshot);
  });
});

describe("live adapters", () => {
  it("expose no writable fields and refuse writes", async () => {
    const adapters = [
      libbyAdapter({ sync: async () => ({}) } as never),
      fableAdapter(async () => ({ next: null, results: [] }) as never),
    ];
    for (const adapter of adapters) {
      expect(adapter.writableFields).toEqual([]);
      await expect(adapter.write({} as never, {} as never, async () => {})).rejects.toThrow(/not verified/);
      expect(await adapter.read({ userId: "u", connectionId: "c" })).toEqual([]);
    }
  });

  it("reads Libby progress per loan and leaves it unknown when Libby has none", async () => {
    const adapter = libbyAdapter({
      sync: async () => ({
        loans: [
          { id: "11", cardId: "1", title: "Dune", type: { id: "audiobook" } },
          { id: "12", cardId: "1", title: "Emma", type: { id: "ebook" } },
        ],
      }),
      loanProgress: async ({ titleId }: { titleId: string }) =>
        titleId === "11" ? 85 : Promise.reject(new Error("404")),
    } as never);
    const books = await adapter.read({ userId: "u", connectionId: "c" });
    expect(books.map((book) => book.fields.readingProgress)).toEqual([{ value: 85 }, undefined]);
  });
});

describe("adding a Libby loan to Fable", () => {
  const ids = { userId: "u", connectionId: "c" };
  const loans = {
    sync: async () => ({
      loans: [
        {
          id: "11",
          cardId: "1",
          title: "The Road to Tender Hearts",
          firstCreatorName: "Ann Author",
          type: { id: "audiobook" },
        },
      ],
    }),
    loanProgress: async () => 85,
  } as never;

  /** A fake fable.co: a catalog search, the user's lists, and a picker that records adds. */
  function fakeFable(
    search: unknown[] = [{ id: "cat-1", title: "The Road to Tender Hearts", authors: [{ name: "Ann Author" }] }],
  ) {
    const posts: { path: string; body: unknown }[] = [];
    const onList: { id: string; title: string }[] = [];
    const get = async (path: string, query: Record<string, string | number>) => {
      if (path === "/api/search") return { books: search };
      if (path === "/api/me/book-lists")
        return { next: null, results: [{ id: "cur", name: "Currently Reading", system_type: "current_reading" }] };
      return {
        next: null,
        results: onList.map((book) => ({
          note: null,
          book: { id: book.id, title: book.title, authors: [{ name: "Ann Author" }], reading_progress: null },
        })),
        query,
      };
    };
    const post = async (path: string, body: unknown) => {
      posts.push({ path, body });
      onList.push({ id: "cat-1", title: "The Road to Tender Hearts" });
      return { applied: true };
    };
    return { get: get as never, post: post as never, posts };
  }

  it("proposes the add, writes it through the list picker, and verifies it", async () => {
    const { get, post, posts } = fakeFable();
    const adapters = { libby: libbyAdapter(loans), fable: fableAdapter(get, post) };
    const plan = await previewSync({ context: ids, settings: resolveSyncSettings(), adapters });
    expect(plan.operations).toMatchObject([
      {
        field: "readingStatus",
        target: "fable",
        after: "currently-reading",
        create: { title: "The Road to Tender Hearts" },
      },
    ]);
    expect(plan.operations[0]?.blocked).toBeUndefined();
    const report = await applySync({
      context: ids,
      settings: resolveSyncSettings(),
      plan,
      adapters,
      journal: createMemoryJournal(),
      approvals: { selected: [plan.operations[0]!.id], removals: [] },
    });
    expect(posts).toEqual([
      { path: "/api/me/book-lists/picker", body: { book_id: "cat-1", book_list_ids: ["cur"], exclude_from: [] } },
    ]);
    expect(report.outcomes).toMatchObject([{ status: "success" }]);
  });

  it("blocks the add when Fable has no write capability", async () => {
    const { get } = fakeFable();
    const plan = await previewSync({
      context: ids,
      settings: resolveSyncSettings(),
      adapters: { libby: libbyAdapter(loans), fable: fableAdapter(get) },
    });
    expect(plan.operations[0]?.blocked).toMatch(/not verified/);
  });

  it("adds nothing when a loan has no progress", async () => {
    const { get, post } = fakeFable();
    const noProgress = { ...(loans as object), loanProgress: async () => undefined } as never;
    const plan = await previewSync({
      context: ids,
      settings: resolveSyncSettings(),
      adapters: { libby: libbyAdapter(noProgress), fable: fableAdapter(get, post) },
    });
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts[0]?.message).toMatch(/No matched destination/);
  });

  it("matches a Fable book whose ISBN is spelled differently", async () => {
    const isbnLoans = {
      sync: async () => ({
        loans: [
          {
            id: "11",
            cardId: "1",
            title: "The Road to Tender Hearts",
            type: { id: "audiobook" },
            formats: [{ id: "audiobook-mp3", identifiers: [{ type: "ISBN", value: "9780441172719" }] }],
          },
        ],
      }),
      loanProgress: async () => 85,
    } as never;
    // Same title twice, so only the ISBN can pick the book; Fable spells it as ISBN-10 with hyphens.
    const { get, post, posts } = fakeFable([
      { id: "cat-1", title: "The Road to Tender Hearts", isbn: "0-441-17271-7" },
      { id: "cat-2", title: "The Road to Tender Hearts", isbn: "9999999999999" },
    ]);
    const adapters = { libby: libbyAdapter(isbnLoans), fable: fableAdapter(get, post) };
    const plan = await previewSync({ context: ids, settings: resolveSyncSettings(), adapters });
    await applySync({
      context: ids,
      settings: resolveSyncSettings(),
      plan,
      adapters,
      journal: createMemoryJournal(),
      approvals: { selected: [plan.operations[0]!.id], removals: [] },
    });
    expect(posts).toMatchObject([{ body: { book_id: "cat-1" } }]);
  });

  it("refuses to guess between several Fable books with the same title", async () => {
    const twin = { id: "x", title: "The Road to Tender Hearts", authors: [{ name: "Other Person" }] };
    const { get, post, posts } = fakeFable([twin, { ...twin, id: "y" }]);
    const adapters = { libby: libbyAdapter(loans), fable: fableAdapter(get, post) };
    const plan = await previewSync({ context: ids, settings: resolveSyncSettings(), adapters });
    const report = await applySync({
      context: ids,
      settings: resolveSyncSettings(),
      plan,
      adapters,
      journal: createMemoryJournal(),
      approvals: { selected: [plan.operations[0]!.id], removals: [] },
    });
    expect(posts).toEqual([]);
    expect(report.outcomes[0]).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/No single Fable book/),
    });
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
