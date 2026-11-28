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
  it("keeps a system list's status when a custom list follows it", () => {
    const book = { id: "b1", title: "Piranesi" };
    const [snapshot] = fableSnapshots([
      { list: { id: "l1", name: "Want to Read", system_type: "want_to_read" }, entries: [{ book, note: null }] },
      { list: { id: "l2", name: "Favorites", system_type: null }, entries: [{ book, note: null }] },
    ]);
    expect(snapshot?.fields.readingStatus).toEqual({ value: "want-to-read" });
  });

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
  it("looks up the ISBN by checkout title ID and takes it only from the loan's format", async () => {
    const lookups: string[][] = [];
    const client = {
      sync: async () => ({
        cards: [{ cardId: "1", advantageKey: "library" }],
        loans: [{ id: "11", cardId: "1", title: "Alchemised", type: { id: "audiobook" } }],
      }),
      loanProgress: async () => 25,
    } as never;
    const adapter = libbyAdapter(client, undefined, {
      getLibraryMedia: async (library, titleId) => {
        lookups.push([library, titleId]);
        return {
          id: titleId,
          title: "Alchemised",
          type: { id: "audiobook" },
          formats: [
            { id: "ebook-epub-open", identifiers: [{ type: "ISBN", value: "9781101658055" }] },
            { id: "audiobook-mp3", identifiers: [{ type: "ISBN", value: "9780553897821" }] },
          ],
        };
      },
    });
    expect(await adapter.read({ userId: "u", connectionId: "c" })).toMatchObject([
      { format: "audiobook", isbn: "9780553897821" },
    ]);
    expect(lookups).toEqual([["library", "11"]]);
  });

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
    search: unknown[] = [
      { id: "cat-1", title: "The Road to Tender Hearts", format: "audiobook", authors: [{ name: "Ann Author" }] },
    ],
  ) {
    const posts: { path: string; body: unknown }[] = [];
    const searches: string[] = [];
    const onList: { id: string; title: string }[] = [];
    const get = async (path: string, query: Record<string, string | number>) => {
      if (path === "/api/search") {
        searches.push(String(query.q));
        return { books: search };
      }
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
      const id = (body as { book_id: string }).book_id;
      const book = (search as { id: string; title: string }[]).find((candidate) => candidate.id === id);
      if (book) onList.push(book);
      return { applied: true };
    };
    return { get: get as never, post: post as never, posts, searches };
  }

  it("clips suggestions at the title score threshold and excludes incompatible formats", async () => {
    const { get, post } = fakeFable([
      { id: "audio", title: "Alchemised", format: "audiobook", authors: [{ name: "SenLinYu" }] },
      { id: "ebook", title: "Alchemised", format: "ebook", authors: [{ name: "SenLinYu" }] },
      { id: "print", title: "Alchemised", format: "Hardback", authors: [{ name: "SenLinYu" }] },
      { id: "near", title: "Alchemized", format: "audiobook", authors: [{ name: "SenLinYu" }] },
      { id: "low", title: "Unrelated", format: "audiobook", authors: [{ name: "SenLinYu" }] },
    ]);
    const libby = libbyAdapter({
      sync: async () => ({
        loans: [
          { id: "11", cardId: "1", title: "Alchemised", firstCreatorName: "SenLinYu", type: { id: "audiobook" } },
        ],
      }),
      loanProgress: async () => 20,
    } as never);
    const input = {
      context: ids,
      settings: resolveSyncSettings(),
      adapters: { libby, fable: fableAdapter(get, post) },
    };
    const strict = await previewSync({ ...input, options: { minTitleScore: 0.9 } });
    expect(strict.catalogMatches["libby:11"]).toMatchObject([{ id: "audio", format: "audiobook", automatic: true }]);
    const relaxed = await previewSync({ ...input, options: { minTitleScore: 0.7 } });
    expect(relaxed.catalogMatches["libby:11"]?.map((book) => book.id)).toEqual(["audio", "near"]);
  });

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

  it("reads the Currently Reading list once per adapter and retries after a failed read", async () => {
    let listReads = 0;
    let failNext = true;
    const posts: unknown[] = [];
    const get = (async (path: string) => {
      if (path === "/api/search") return { books: [{ id: "cat-1", title: "Dune" }] };
      if (path === "/api/me/book-lists") {
        listReads += 1;
        if (failNext) {
          failNext = false;
          throw new Error("Fable is down");
        }
        return { next: null, results: [{ id: "cur", name: "Currently Reading", system_type: "current_reading" }] };
      }
      throw new Error(`unexpected ${path}`);
    }) as never;
    const adapter = fableAdapter(get, (async (_path: string, body: unknown) => posts.push(body)) as never);
    const operation = { field: "readingStatus", after: "currently-reading", create: { title: "Dune" } } as never;
    await expect(adapter.write(ids, operation, async () => {})).rejects.toThrow("Fable is down");
    await adapter.write(ids, operation, async () => {});
    await adapter.write(ids, operation, async () => {});
    expect(listReads).toBe(2);
    expect(posts).toHaveLength(2);
  });

  it("checks the plan is current before any Fable read or write", async () => {
    const calls: string[] = [];
    const adapter = fableAdapter(
      (async (path: string) => {
        calls.push(path);
        return { next: null, results: [] };
      }) as never,
      (async () => calls.push("post")) as never,
    );
    const operation = { field: "readingStatus", after: "currently-reading", create: { title: "Dune" } } as never;
    await expect(
      adapter.write(ids, operation, async () => {
        throw new Error("Library data changed");
      }),
    ).rejects.toThrow("Library data changed");
    expect(calls).toEqual([]);
  });

  it("looks up each unmatched loan in Fable's catalog and applies only the selected edition", async () => {
    const { get, post, posts, searches } = fakeFable([
      { id: "alchemised", title: "Alchemised: A Novel", authors: [{ name: "SenLinYu" }] },
      { id: "other-edition", title: "Alchemised", authors: [{ name: "Sen Lin Yu" }] },
      { id: "piranesi", title: "Piranesi", authors: [{ name: "Susanna Clarke" }] },
    ]);
    const libby = libbyAdapter({
      sync: async () => ({
        loans: [
          { id: "a", cardId: "1", title: "Alchemised", firstCreatorName: "SenLinYu" },
          { id: "p", cardId: "1", title: "Piranesi", firstCreatorName: "Susanna Clarke" },
        ],
      }),
      loanProgress: async ({ titleId }: { titleId: string }) => (titleId === "a" ? 35 : undefined),
    } as never);
    const adapters = { libby, fable: fableAdapter(get, post) };
    const input = { context: ids, settings: resolveSyncSettings(), adapters };
    const preview = await previewSync(input);
    expect(new Set(searches)).toEqual(new Set(["Alchemised", "Piranesi"]));
    expect(preview.catalogMatches["libby:a"]?.map((book) => book.id)).toEqual(["alchemised", "other-edition"]);
    expect(preview.catalogMatches["libby:p"]?.map((book) => book.id)).toEqual(["piranesi"]);
    expect(posts).toEqual([]);
    await expect(previewSync({ ...input, options: { catalogSelections: { "libby:a": "piranesi" } } })).rejects.toThrow(
      /catalog selection/i,
    );
    const plan = await previewSync({ ...input, options: { catalogSelections: { "libby:a": "other-edition" } } });
    const report = await applySync({
      ...input,
      plan,
      journal: createMemoryJournal(),
      approvals: { selected: plan.operations.map((operation) => operation.id), removals: [] },
    });
    expect(posts).toEqual([
      {
        path: "/api/me/book-lists/picker",
        body: { book_id: "other-edition", book_list_ids: ["cur"], exclude_from: [] },
      },
    ]);
    expect(report.outcomes).toMatchObject([{ status: "success" }]);
    const refreshed = await previewSync({ ...input, options: plan.options });
    expect(refreshed.options.matches?.["libby:a"]).toBe("fable:other-edition");
    expect(refreshed.options.catalogSelections?.["libby:a"]).toBeUndefined();
    expect(refreshed.operations.some((operation) => operation.create)).toBe(false);
  });

  it("refuses to guess between several Fable books with the same title", async () => {
    const twin = { id: "x", title: "The Road to Tender Hearts", authors: [{ name: "Other Person" }] };
    const { get, post, posts } = fakeFable([twin, { ...twin, id: "y" }]);
    const adapters = { libby: libbyAdapter(loans), fable: fableAdapter(get, post) };
    const plan = await previewSync({ context: ids, settings: resolveSyncSettings(), adapters });
    expect(plan.catalogMatches["libby:11"]?.map((book) => book.id)).toEqual(["x", "y"]);
    expect(plan.operations).toEqual([]);
    expect(posts).toEqual([]);
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
