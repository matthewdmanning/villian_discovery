import { describe, expect, it, vi } from "vitest";
import { createGoogleBooksIsbnLookup, createIsbnLookup, createOpenLibraryIsbnLookup } from "../src/isbn-lookup.js";

const ISBN13 = "9780593135204";
const ISBN10 = "0593135202";
const openEntry = {
  title: "Project Hail Mary",
  authors: [{ name: "Andy Weir" }],
  cover: { large: "https://covers.openlibrary.org/b/id/123-L.jpg" },
};
const googleEntry = (identifier: string) => ({
  volumeInfo: {
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    industryIdentifiers: [{ type: identifier.length === 10 ? "ISBN_10" : "ISBN_13", identifier }],
    imageLinks: { thumbnail: "http://books.google.com/books/content?id=fixture" },
  },
});

describe("ISBN lookup", () => {
  it("looks up a normalized ISBN-10 on Open Library and reads its cover", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ [`ISBN:${ISBN10}`]: openEntry }));
    const lookup = createOpenLibraryIsbnLookup({ fetch });
    await expect(lookup("0-593-13520-2")).resolves.toEqual({
      title: "Project Hail Mary",
      authors: ["Andy Weir"],
      coverUrl: openEntry.cover.large,
      source: "open-library",
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://openlibrary.org/api/books?bibkeys=ISBN%3A0593135202&jscmd=data&format=json");
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("queries Google Books and accepts only exact or equivalent ISBNs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ totalItems: 2, items: [googleEntry("9780441013593"), googleEntry(ISBN10)] }),
    );
    const lookup = createGoogleBooksIsbnLookup({ fetch, googleApiKey: "test-key" });
    await expect(lookup(ISBN13)).resolves.toMatchObject({
      source: "google-books",
      coverUrl: "https://books.google.com/books/content?id=fixture",
    });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://books.googleapis.com/books/v1/volumes");
    expect([...url.searchParams]).toEqual([
      ["q", `isbn:${ISBN13}`],
      ["key", "test-key"],
    ]);
    fetch.mockResolvedValueOnce(Response.json({ totalItems: 1, items: [googleEntry("9780441013593")] }));
    await expect(lookup(ISBN13)).resolves.toBeNull();
  });

  it.each([{}, { [`ISBN:${ISBN13}`]: { title: "Project Hail Mary" } }, null])(
    "falls back to Google Books when Open Library misses, lacks the author, or fails",
    async (response) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response ? Response.json(response) : new Response(null, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ totalItems: 1, items: [googleEntry(ISBN13)] }));
      await expect(createIsbnLookup({ fetch })(ISBN13)).resolves.toMatchObject({ source: "google-books" });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("uses Open Library alone when it resolves the ISBN and rejects invalid input before HTTP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ [`ISBN:${ISBN13}`]: openEntry }));
    const lookup = createIsbnLookup({ fetch });
    await expect(lookup(ISBN13)).resolves.toMatchObject({ source: "open-library" });
    await expect(lookup("9780593135205")).rejects.toThrow("Enter a valid ISBN");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a provider failure from two confirmed misses and keeps the key out of errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ totalItems: 0 }))
      .mockResolvedValueOnce(Response.json({}))
      .mockRejectedValueOnce(new Error("https://books.googleapis.com/books/v1/volumes?key=test-key"));
    const lookup = createIsbnLookup({ fetch, googleApiKey: "test-key" });
    await expect(lookup(ISBN13)).resolves.toBeNull();
    await expect(lookup(ISBN13)).rejects.toThrow(/^Google Books could not be reached\.$/);
  });
});
