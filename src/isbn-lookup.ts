import { z } from "zod";
import { normalizeIsbn } from "./input.js";
import { stripUndefined } from "./util.js";

export interface IsbnBook {
  title: string;
  subtitle?: string;
  authors: string[];
  coverUrl?: string;
  source: "open-library" | "google-books";
}

export type IsbnLookup = (isbn: string) => Promise<IsbnBook | null>;

interface LookupOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface IsbnLookupOptions extends LookupOptions {
  googleApiKey?: string;
}

const nonempty = z.string().trim().min(1);
const openLibraryBook = z.object({
  title: nonempty,
  subtitle: nonempty.optional(),
  authors: z.array(z.object({ name: nonempty })).optional(),
  cover: z
    .object({ large: z.string().optional(), medium: z.string().optional(), small: z.string().optional() })
    .optional(),
});
const googleBook = z.object({
  volumeInfo: z.object({
    title: nonempty,
    subtitle: nonempty.optional(),
    authors: z.array(nonempty).optional(),
    industryIdentifiers: z.array(z.object({ type: z.string(), identifier: z.string() })),
    imageLinks: z.object({ thumbnail: z.string().optional(), smallThumbnail: z.string().optional() }).optional(),
  }),
});
const googleResults = z.object({ items: z.array(z.unknown()).default([]), totalItems: z.number() });

function isbn13CheckDigit(digits: string): string {
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

/** Return the ISBN-13 form of a valid ISBN. ISBN-10 and its 978 equivalent identify the same edition. */
function canonicalIsbn(value: string): string | undefined {
  const isbn = normalizeIsbn(value);
  if (!isbn) return undefined;
  if (isbn.length === 13) {
    return /^97[89]/.test(isbn) && isbn13CheckDigit(isbn.slice(0, 12)) === isbn[12] ? isbn : undefined;
  }
  const sum = [...isbn].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
  if (sum % 11) return undefined;
  const digits = `978${isbn.slice(0, 9)}`;
  return digits + isbn13CheckDigit(digits);
}

function requireIsbn(value: string): { isbn: string; canonical: string } {
  const isbn = normalizeIsbn(value);
  const canonical = isbn && canonicalIsbn(isbn);
  if (!isbn || !canonical) throw new Error("Enter a valid ISBN-10 or ISBN-13.");
  return { isbn, canonical };
}

function coverUrl(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.protocol = "https:";
  return url.href;
}

async function getJson(url: URL, service: string, options: LookupOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
  } catch {
    throw new Error(`${service} could not be reached.`);
  }
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${service} returned invalid book data.`);
  }
}

export function createOpenLibraryIsbnLookup(options: LookupOptions = {}): IsbnLookup {
  return async (value) => {
    const { isbn } = requireIsbn(value);
    const key = `ISBN:${isbn}`;
    const url = new URL("https://openlibrary.org/api/books");
    url.search = new URLSearchParams({ bibkeys: key, jscmd: "data", format: "json" }).toString();
    const response = z.record(z.string(), z.unknown()).safeParse(await getJson(url, "Open Library", options));
    if (!response.success) throw new Error("Open Library returned invalid book data.");
    if (!Object.hasOwn(response.data, key)) return null;
    const result = openLibraryBook.safeParse(response.data[key]);
    if (!result.success) throw new Error("Open Library returned invalid book data.");
    const { title, subtitle, authors, cover } = result.data;
    return stripUndefined({
      title,
      subtitle,
      authors: authors?.map(({ name }) => name) ?? [],
      coverUrl: coverUrl(cover?.large ?? cover?.medium ?? cover?.small),
      source: "open-library" as const,
    });
  };
}

export function createGoogleBooksIsbnLookup(options: IsbnLookupOptions = {}): IsbnLookup {
  return async (value) => {
    const { isbn, canonical } = requireIsbn(value);
    const url = new URL("https://books.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", `isbn:${isbn}`);
    if (options.googleApiKey) url.searchParams.set("key", options.googleApiKey);
    const response = googleResults.safeParse(await getJson(url, "Google Books", options));
    if (!response.success) throw new Error("Google Books returned invalid book data.");
    let incomplete: IsbnBook | null = null;
    for (const candidate of response.data.items) {
      const result = googleBook.safeParse(candidate);
      if (!result.success) continue;
      const { title, subtitle, authors, industryIdentifiers, imageLinks } = result.data.volumeInfo;
      if (
        !industryIdentifiers.some(
          ({ type, identifier }) => /^ISBN_(10|13)$/.test(type) && canonicalIsbn(identifier) === canonical,
        )
      ) {
        continue;
      }
      const book = stripUndefined({
        title,
        subtitle,
        authors: authors ?? [],
        coverUrl: coverUrl(imageLinks?.thumbnail ?? imageLinks?.smallThumbnail),
        source: "google-books" as const,
      });
      if (book.authors.length) return book;
      incomplete ??= book;
    }
    return incomplete;
  };
}

/** Try Open Library first, then Google Books on a miss, incomplete authorship, or failure. */
export function createIsbnLookup(options: IsbnLookupOptions = {}): IsbnLookup {
  const providers = [createOpenLibraryIsbnLookup(options), createGoogleBooksIsbnLookup(options)];
  return async (isbn) => {
    requireIsbn(isbn);
    const errors: string[] = [];
    let incomplete: IsbnBook | null = null;
    for (const lookup of providers) {
      try {
        const book = await lookup(isbn);
        if (book?.authors.length) return book;
        incomplete ??= book;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (incomplete) return incomplete;
    if (errors.length) throw new Error(errors.join(" "));
    return null;
  };
}
