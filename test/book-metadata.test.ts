import { describe, expect, it, vi } from "vitest";
import {
  type BookMetadataSource,
  type BookRecord,
  canonicalIsbn,
  createBookMetadata,
  createGoogleBooksSource,
  createOpenLibrarySource,
} from "../src/book-metadata.js";

const ISBN13 = "9780593135204";
const ISBN10 = "0593135202";
const json = (body: unknown) => Response.json(body);
const fetchOf = (...bodies: (unknown | Response | Error)[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const body of bodies) {
    if (body instanceof Error) fetch.mockRejectedValueOnce(body);
    else fetch.mockResolvedValueOnce(body instanceof Response ? body : json(body));
  }
  return fetch;
};
const urlOf = (fetch: ReturnType<typeof fetchOf>, call = 0) => new URL(String(fetch.mock.calls[call]![0]));

const openEdition = {
  url: "http://openlibrary.org/books/OL1M/Project_Hail_Mary",
  title: "Project Hail Mary",
  authors: [{ name: "Andy Weir" }],
  publishers: [{ name: "Ballantine" }],
  publish_date: "2021",
  number_of_pages: 496,
  identifiers: { isbn_13: [ISBN13, "9780593395561"], isbn_10: [ISBN10, "not-an-isbn"] },
  cover: { large: "https://covers.openlibrary.org/b/id/123-L.jpg" },
};
const openWork = {
  key: "/works/OL1W",
  title: "Project Hail Mary",
  author_name: ["Andy Weir"],
  isbn: [ISBN10, ISBN13, "9780593395561", "bad"],
  first_publish_year: 2021,
  publisher: ["Ballantine"],
  language: ["eng"],
  cover_i: 123,
  number_of_pages_median: 496,
};
const googleVolume = (identifier: string, over: Record<string, unknown> = {}) => ({
  volumeInfo: {
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    publisher: "Ballantine",
    publishedDate: "2021-05-04",
    description: "A lone astronaut.",
    pageCount: 496,
    language: "en",
    industryIdentifiers: [{ type: identifier.length === 10 ? "ISBN_10" : "ISBN_13", identifier }],
    imageLinks: { thumbnail: "http://books.google.com/books/content?id=fixture" },
    infoLink: "http://books.google.com/books?id=fixture",
    ...over,
  },
});

describe("canonicalIsbn", () => {
  it("returns the ISBN-13 for valid ISBN-10s and ISBN-13s only", () => {
    expect(canonicalIsbn("0-593-13520-2")).toBe(ISBN13);
    expect(canonicalIsbn(ISBN13)).toBe(ISBN13);
    expect(canonicalIsbn("9780593135205")).toBeUndefined();
    expect(canonicalIsbn("0593135203")).toBeUndefined();
  });
});

describe("Open Library", () => {
  it("resolves an ISBN to its edition, looked-up ISBN first, with no cookies or referrer", async () => {
    const fetch = fetchOf({ [`ISBN:${ISBN10}`]: openEdition });
    const book = await createOpenLibrarySource({ fetch }).byIsbn("0-593-13520-2");
    expect(book).toEqual({
      title: "Project Hail Mary",
      authors: ["Andy Weir"],
      isbns: [ISBN13, "9780593395561"],
      publisher: "Ballantine",
      publishedDate: "2021",
      pageCount: 496,
      coverUrl: openEdition.cover.large,
      infoUrl: "https://openlibrary.org/books/OL1M/Project_Hail_Mary",
      source: "open-library",
    });
    expect(String(urlOf(fetch))).toBe(
      "https://openlibrary.org/api/books?bibkeys=ISBN%3A0593135202&jscmd=data&format=json",
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("returns null for an unknown ISBN and rejects an invalid one before any request", async () => {
    const fetch = fetchOf({});
    const source = createOpenLibrarySource({ fetch });
    await expect(source.byIsbn(ISBN13)).resolves.toBeNull();
    await expect(source.byIsbn("9780593135205")).rejects.toThrow("Enter a valid ISBN");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("searches by title and author and lists each work's edition ISBNs", async () => {
    const fetch = fetchOf({ docs: [openWork, { title: "missing key" }] });
    const books = await createOpenLibrarySource({ fetch }).search({ title: "Hail Mary", author: "Weir" }, 5);
    expect(books).toEqual([
      {
        title: "Project Hail Mary",
        authors: ["Andy Weir"],
        isbns: [ISBN13, "9780593395561"],
        publisher: "Ballantine",
        publishedDate: "2021",
        pageCount: 496,
        language: "eng",
        coverUrl: "https://covers.openlibrary.org/b/id/123-M.jpg",
        infoUrl: "https://openlibrary.org/works/OL1W",
        source: "open-library",
      },
    ]);
    const url = urlOf(fetch);
    expect(url.origin + url.pathname).toBe("https://openlibrary.org/search.json");
    expect(url.searchParams.get("title")).toBe("Hail Mary");
    expect(url.searchParams.get("author")).toBe("Weir");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("sends free text as q and rejects an empty query", async () => {
    const fetch = fetchOf({ docs: [] });
    const source = createOpenLibrarySource({ fetch });
    await source.search({ text: "hail mary weir" });
    expect(urlOf(fetch).searchParams.get("q")).toBe("hail mary weir");
    await expect(source.search({ title: "  " })).rejects.toThrow("Enter a title, author or search text.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Google Books", () => {
  it("resolves an ISBN only from a volume that carries that edition, with the optional key", async () => {
    const fetch = fetchOf({ totalItems: 2, items: [googleVolume("9780441013593"), googleVolume(ISBN10)] });
    const book = await createGoogleBooksSource({ fetch, googleApiKey: "test-key" }).byIsbn(ISBN13);
    expect(book).toMatchObject({
      title: "Project Hail Mary",
      isbns: [ISBN13],
      description: "A lone astronaut.",
      language: "en",
      coverUrl: "https://books.google.com/books/content?id=fixture",
      infoUrl: "https://books.google.com/books?id=fixture",
      source: "google-books",
    });
    expect([...urlOf(fetch).searchParams]).toEqual([
      ["q", `isbn:${ISBN13}`],
      ["maxResults", "10"],
      ["printType", "books"],
      ["key", "test-key"],
    ]);
  });

  it("prefers a volume that names an author and misses when no volume carries the ISBN", async () => {
    const fetch = fetchOf(
      { totalItems: 2, items: [googleVolume(ISBN13, { authors: [] }), googleVolume(ISBN13, { title: "With author" })] },
      { totalItems: 1, items: [googleVolume("9780441013593")] },
    );
    const source = createGoogleBooksSource({ fetch });
    await expect(source.byIsbn(ISBN13)).resolves.toMatchObject({ title: "With author" });
    await expect(source.byIsbn(ISBN13)).resolves.toBeNull();
  });

  it("searches with intitle and inauthor phrases", async () => {
    const fetch = fetchOf({ totalItems: 1, items: [googleVolume(ISBN13)] });
    const books = await createGoogleBooksSource({ fetch }).search({ title: 'Hail "Mary"', author: "Weir" }, 3);
    expect(books.map((book) => book.title)).toEqual(["Project Hail Mary"]);
    expect(urlOf(fetch).searchParams.get("q")).toBe('intitle:"Hail  Mary" inauthor:"Weir"');
    expect(urlOf(fetch).searchParams.get("maxResults")).toBe("3");
  });

  it("explains a rate limit and never repeats a URL that carries the key", async () => {
    const source = createGoogleBooksSource({
      fetch: fetchOf(new Response(null, { status: 429 }), new Error("https://books.googleapis.com/?key=test-key")),
      googleApiKey: "test-key",
    });
    await expect(source.byIsbn(ISBN13)).rejects.toThrow("Google Books is rate limiting requests; try again later.");
    await expect(source.byIsbn(ISBN13)).rejects.toThrow(/^Google Books could not be reached\.$/);
  });
});

describe("combined metadata", () => {
  const record = (over: Partial<BookRecord> = {}): BookRecord => ({
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    isbns: [ISBN13],
    source: "open-library",
    ...over,
  });
  const source = (over: Partial<BookMetadataSource> = {}): BookMetadataSource => ({
    id: "open-library",
    byIsbn: vi.fn(async () => null),
    search: vi.fn(async () => []),
    ...over,
  });

  it.each([
    ["misses", async () => null],
    ["has no author", async () => record({ authors: [] })],
    [
      "fails",
      async () => {
        throw new Error("down");
      },
    ],
  ])("falls back to the next source when the first %s", async (_case, firstByIsbn) => {
    const second = record({ source: "google-books" });
    const metadata = createBookMetadata([
      source({ byIsbn: firstByIsbn }),
      source({ id: "google-books", byIsbn: async () => second }),
    ]);
    await expect(metadata.byIsbn(ISBN13)).resolves.toBe(second);
  });

  it("keeps an authorless result, tells misses from failures, and checks the ISBN first", async () => {
    const authorless = record({ authors: [] });
    await expect(
      createBookMetadata([source({ byIsbn: async () => authorless }), source()]).byIsbn(ISBN13),
    ).resolves.toBe(authorless);
    await expect(createBookMetadata([source(), source()]).byIsbn(ISBN13)).resolves.toBeNull();
    const failing = source({
      byIsbn: async () => {
        throw new Error("Open Library could not be reached.");
      },
    });
    // A failure plus a miss cannot confirm the ISBN is unknown, so the failure is reported.
    await expect(createBookMetadata([failing, source()]).byIsbn(ISBN13)).rejects.toThrow("could not be reached");
    const unused = source();
    await expect(createBookMetadata([unused]).byIsbn("123")).rejects.toThrow("Enter a valid ISBN");
    expect(unused.byIsbn).not.toHaveBeenCalled();
  });

  it("merges searches up to the limit, skipping books an earlier source returned", async () => {
    const first = source({ search: async () => [record(), record({ title: "Artemis", isbns: ["9780553448122"] })] });
    const second = source({
      id: "google-books",
      search: async () => [
        record({ source: "google-books" }),
        record({ title: "The Martian", isbns: [], source: "google-books" }),
        record({ title: "Project hail mary", isbns: [], source: "google-books" }),
        record({ title: "Extra", isbns: ["9780306406157"], source: "google-books" }),
      ],
    });
    const books = await createBookMetadata([first, second]).search({ title: "weir" }, 3);
    expect(books.map((book) => [book.title, book.source])).toEqual([
      ["Project Hail Mary", "open-library"],
      ["Artemis", "open-library"],
      ["The Martian", "google-books"],
    ]);
  });

  it("asks the next source only when the first falls short, and fails only when all fail", async () => {
    const full = source({ search: async () => [record()] });
    const second = source({ id: "google-books" });
    await createBookMetadata([full, second]).search({ title: "x" }, 1);
    expect(second.search).not.toHaveBeenCalled();
    const down = source({
      search: async () => {
        throw new Error("down");
      },
    });
    await expect(
      createBookMetadata([down, source({ search: async () => [record()] })]).search({ text: "x" }),
    ).resolves.toHaveLength(1);
    await expect(createBookMetadata([down, down]).search({ text: "x" })).rejects.toThrow("down down");
  });

  it("defaults to Open Library, then Google Books", async () => {
    const fetch = fetchOf({}, { totalItems: 1, items: [googleVolume(ISBN13)] });
    await expect(createBookMetadata([], { fetch }).byIsbn(ISBN13)).resolves.toMatchObject({ source: "google-books" });
    expect(urlOf(fetch, 0).hostname).toBe("openlibrary.org");
    expect(urlOf(fetch, 1).hostname).toBe("books.googleapis.com");
  });
});
