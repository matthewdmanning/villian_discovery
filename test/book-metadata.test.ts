import { describe, expect, it, vi } from "vitest";
import {
  type BookMetadataSource,
  type BookRecord,
  canonicalIsbn,
  createBookMetadata,
  createGoogleBooksSource,
  createOpenLibrarySource,
  editionFormat,
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

describe("editionFormat", () => {
  it("reads common edition labels", () => {
    expect(
      [
        "eAudiobook",
        "Audio CD",
        "MP3 CD",
        "ebook",
        "Kindle Edition",
        "Paperback",
        "Hardcover",
        "Mass Market Paperback",
        "Unknown",
        undefined,
      ].map(editionFormat),
    ).toEqual([
      "audiobook",
      "audiobook",
      "audiobook",
      "ebook",
      "ebook",
      "print",
      "print",
      "print",
      undefined,
      undefined,
    ]);
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

  it("lists every edition of the looked-up ISBN's work, with formats", async () => {
    const fetch = fetchOf(
      { key: "/books/OL1M", works: [{ key: "/works/OL1W" }] },
      {
        entries: [
          { isbn_13: ["9780593395561"], physical_format: "eAudiobook" },
          { isbn_10: ["0593135210"], physical_format: "Paperback" },
          { isbn_13: [ISBN13], physical_format: "Hardcover" },
          { physical_format: "ebook" },
        ],
      },
    );
    await expect(createOpenLibrarySource({ fetch }).editions(ISBN10)).resolves.toEqual([
      { isbn: ISBN13, format: "print" },
      { isbn: "9780593395561", format: "audiobook" },
      { isbn: "9780593135211", format: "print" },
    ]);
    expect(String(urlOf(fetch, 0))).toBe(`https://openlibrary.org/isbn/${ISBN13}.json`);
    expect(String(urlOf(fetch, 1))).toBe("https://openlibrary.org/works/OL1W/editions.json?limit=500");
  });

  it("lists only the ISBN itself when Open Library has no edition record or work", async () => {
    const source = createOpenLibrarySource({
      fetch: fetchOf(new Response(null, { status: 404 }), { key: "/books/OL1M", works: [] }),
    });
    await expect(source.editions(ISBN13)).resolves.toEqual([{ isbn: ISBN13 }]);
    await expect(source.editions(ISBN13)).resolves.toEqual([{ isbn: ISBN13 }]);
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

  it("lists a volume's own ISBNs as its editions, having no work grouping", async () => {
    const volume = googleVolume(ISBN13, {
      industryIdentifiers: [
        { type: "ISBN_13", identifier: ISBN13 },
        { type: "ISBN_10", identifier: ISBN10 },
        { type: "OTHER", identifier: "x" },
      ],
    });
    const source = createGoogleBooksSource({ fetch: fetchOf({ totalItems: 1, items: [volume] }, { totalItems: 0 }) });
    await expect(source.editions(ISBN13)).resolves.toEqual([{ isbn: ISBN13 }]);
    await expect(source.editions(ISBN13)).resolves.toEqual([{ isbn: ISBN13 }]);
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
    editions: vi.fn(async (isbn: string) => [{ isbn }]),
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

  it("takes editions from the first source that answers", async () => {
    const audio = { isbn: "9780593395561", format: "audiobook" as const };
    const first = source({
      editions: vi.fn(async () => {
        throw new Error("Open Library could not be reached.");
      }),
    });
    const second = source({ id: "google-books", editions: vi.fn(async () => [{ isbn: ISBN13 }, audio]) });
    await expect(createBookMetadata([first, second]).editions(ISBN10)).resolves.toEqual([{ isbn: ISBN13 }, audio]);
    expect(first.editions).toHaveBeenCalledWith(ISBN13);
    const answered = source({ editions: vi.fn(async () => [audio]) });
    const unused = source();
    await createBookMetadata([answered, unused]).editions(ISBN13);
    expect(unused.editions).not.toHaveBeenCalled();
    await expect(createBookMetadata([first, first]).editions(ISBN13)).rejects.toThrow("could not be reached");
  });

  it("caches answers per ISBN, whatever its spelling, but never a failure", async () => {
    const byIsbn = vi
      .fn<BookMetadataSource["byIsbn"]>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(record());
    const metadata = createBookMetadata([source({ byIsbn })]);
    await expect(metadata.byIsbn(ISBN13)).rejects.toThrow("down");
    await expect(metadata.byIsbn(ISBN13)).resolves.toEqual(record());
    await expect(metadata.byIsbn("0-593-13520-2")).resolves.toEqual(record());
    expect(byIsbn).toHaveBeenCalledTimes(2);
    const editions = vi.fn(async (isbn: string) => [{ isbn }]);
    const cached = createBookMetadata([source({ editions })]);
    await cached.editions(ISBN13);
    await cached.editions(ISBN10);
    expect(editions).toHaveBeenCalledTimes(1);
  });

  it("defaults to Open Library, then Google Books", async () => {
    const fetch = fetchOf({}, { totalItems: 1, items: [googleVolume(ISBN13)] });
    await expect(createBookMetadata([], { fetch }).byIsbn(ISBN13)).resolves.toMatchObject({ source: "google-books" });
    expect(urlOf(fetch, 0).hostname).toBe("openlibrary.org");
    expect(urlOf(fetch, 1).hostname).toBe("books.googleapis.com");
  });
});
