/**
 * Public book metadata: one interface, `BookMetadataSource`, with an Open Library and a Google Books
 * implementation, and a combined source that falls back between them. Requests send only the ISBN or
 * the title and author being looked up, with no cookies or referrer.
 */
import { z } from "zod";
import { normalizeIsbn } from "./input.js";
import { normalizeName, normalizeTitle } from "./matcher.js";
import { stripUndefined } from "./util.js";

export type BookMetadataSourceId = "open-library" | "google-books";

/** One book (an edition for an ISBN lookup, a work or volume for a search) as a metadata service describes it. */
export interface BookRecord {
  title: string;
  subtitle?: string;
  authors: string[];
  /** ISBN-13s. For an ISBN lookup, the looked-up edition comes first; for a search, every known edition. */
  isbns: string[];
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  /** Language code as the service reports it, e.g. "en" or "eng". */
  language?: string;
  description?: string;
  coverUrl?: string;
  /** The service's own page for the book. */
  infoUrl?: string;
  source: BookMetadataSourceId;
}

/** What to search for: a title and/or author, or free text. */
export interface BookQuery {
  title?: string;
  author?: string;
  text?: string;
}

export interface BookMetadataSource {
  readonly id: BookMetadataSourceId | "combined";
  /** Resolve an ISBN-10 or ISBN-13 to its book: title, authors and other details. Null when unknown. */
  byIsbn(isbn: string): Promise<BookRecord | null>;
  /** Find books by title, author or text, best match first, with the ISBNs of their editions. */
  search(query: BookQuery, limit?: number): Promise<BookRecord[]>;
}

/** Resolve one ISBN to its book; the shape `LibraryApi.lookupIsbn` exposes to the UI. */
export type IsbnLookup = (isbn: string) => Promise<BookRecord | null>;

export interface BookMetadataOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Optional Google Books API key; without one, Google's shared keyless quota applies. */
  googleApiKey?: string;
}

const MAX_SEARCH_RESULTS = 40;
const MAX_ISBNS = 40;

const nonempty = z.string().trim().min(1);
const named = z.object({ name: nonempty });
const openLibraryEdition = z.object({
  title: nonempty,
  subtitle: nonempty.optional(),
  authors: z.array(named).optional(),
  publishers: z.array(named).optional(),
  publish_date: nonempty.optional(),
  number_of_pages: z.number().int().positive().optional(),
  identifiers: z
    .object({ isbn_10: z.array(z.string()).optional(), isbn_13: z.array(z.string()).optional() })
    .optional(),
  cover: z
    .object({ large: z.string().optional(), medium: z.string().optional(), small: z.string().optional() })
    .optional(),
  url: z.string().optional(),
});
const openLibrarySearch = z.object({
  docs: z.array(z.unknown()).default([]),
});
const openLibraryWork = z.object({
  key: nonempty,
  title: nonempty,
  subtitle: nonempty.optional(),
  author_name: z.array(nonempty).optional(),
  isbn: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  publisher: z.array(nonempty).optional(),
  language: z.array(nonempty).optional(),
  cover_i: z.number().int().optional(),
  number_of_pages_median: z.number().int().positive().optional(),
});
const googleVolume = z.object({
  volumeInfo: z.object({
    title: nonempty,
    subtitle: nonempty.optional(),
    authors: z.array(nonempty).optional(),
    publisher: nonempty.optional(),
    publishedDate: nonempty.optional(),
    description: nonempty.optional(),
    pageCount: z.number().int().positive().optional(),
    language: nonempty.optional(),
    industryIdentifiers: z.array(z.object({ type: z.string(), identifier: z.string() })).default([]),
    imageLinks: z.object({ thumbnail: z.string().optional(), smallThumbnail: z.string().optional() }).optional(),
    infoLink: z.string().optional(),
  }),
});
const googleResults = z.object({ items: z.array(z.unknown()).default([]), totalItems: z.number() });

function isbn13CheckDigit(digits: string): string {
  const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

/** Return the ISBN-13 form of a valid ISBN. ISBN-10 and its 978 equivalent identify the same edition. */
export function canonicalIsbn(value: string): string | undefined {
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

/** Valid ISBN-13s of `values`, in order, once each, with `first` (if given) leading. */
function isbnList(values: readonly string[], first?: string): string[] {
  const isbns = new Set(first ? [first] : []);
  for (const value of values) {
    const isbn = canonicalIsbn(value);
    if (isbn) isbns.add(isbn);
    if (isbns.size >= MAX_ISBNS) break;
  }
  return [...isbns];
}

function requireQuery(query: BookQuery): BookQuery {
  const clean = stripUndefined({ title: query.title?.trim(), author: query.author?.trim(), text: query.text?.trim() });
  if (!clean.title && !clean.author && !clean.text) throw new Error("Enter a title, author or search text.");
  return clean;
}

const resultLimit = (limit: number) => Math.min(Math.max(1, Math.floor(limit)), MAX_SEARCH_RESULTS);

function httpsUrl(value: string | undefined): string | undefined {
  if (!value || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.protocol = "https:";
  return url.href;
}

async function getJson(url: URL, service: string, options: BookMetadataOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
  } catch {
    // The URL can carry an API key, so the cause is never repeated.
    throw new Error(`${service} could not be reached.`);
  }
  if (response.status === 429) throw new Error(`${service} is rate limiting requests; try again later.`);
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${service} returned invalid book data.`);
  }
}

export function createOpenLibrarySource(options: BookMetadataOptions = {}): BookMetadataSource {
  const service = "Open Library";
  return {
    id: "open-library",
    async byIsbn(value) {
      const { isbn, canonical } = requireIsbn(value);
      const key = `ISBN:${isbn}`;
      const url = new URL("https://openlibrary.org/api/books");
      url.search = new URLSearchParams({ bibkeys: key, jscmd: "data", format: "json" }).toString();
      const response = z.record(z.string(), z.unknown()).safeParse(await getJson(url, service, options));
      if (!response.success) throw new Error(`${service} returned invalid book data.`);
      if (!Object.hasOwn(response.data, key)) return null;
      const result = openLibraryEdition.safeParse(response.data[key]);
      if (!result.success) throw new Error(`${service} returned invalid book data.`);
      const book = result.data;
      return stripUndefined({
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors?.map(({ name }) => name) ?? [],
        isbns: isbnList([...(book.identifiers?.isbn_13 ?? []), ...(book.identifiers?.isbn_10 ?? [])], canonical),
        publisher: book.publishers?.[0]?.name,
        publishedDate: book.publish_date,
        pageCount: book.number_of_pages,
        coverUrl: httpsUrl(book.cover?.large ?? book.cover?.medium ?? book.cover?.small),
        infoUrl: httpsUrl(book.url),
        source: "open-library" as const,
      });
    },
    async search(query, limit = 10) {
      const { title, author, text } = requireQuery(query);
      const url = new URL("https://openlibrary.org/search.json");
      url.search = new URLSearchParams(
        stripUndefined({
          q: text,
          title,
          author,
          limit: String(resultLimit(limit)),
          fields:
            "key,title,subtitle,author_name,isbn,first_publish_year,publisher,language,cover_i,number_of_pages_median",
        }),
      ).toString();
      const response = openLibrarySearch.safeParse(await getJson(url, service, options));
      if (!response.success) throw new Error(`${service} returned invalid search results.`);
      return response.data.docs.flatMap((doc) => {
        const result = openLibraryWork.safeParse(doc);
        if (!result.success) return [];
        const work = result.data;
        return [
          stripUndefined({
            title: work.title,
            subtitle: work.subtitle,
            authors: work.author_name ?? [],
            isbns: isbnList(work.isbn ?? []),
            publisher: work.publisher?.[0],
            publishedDate: work.first_publish_year === undefined ? undefined : String(work.first_publish_year),
            pageCount: work.number_of_pages_median,
            language: work.language?.[0],
            coverUrl:
              work.cover_i === undefined ? undefined : `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg`,
            infoUrl: `https://openlibrary.org${work.key}`,
            source: "open-library" as const,
          }),
        ];
      });
    },
  };
}

export function createGoogleBooksSource(options: BookMetadataOptions = {}): BookMetadataSource {
  const service = "Google Books";
  const volumes = async (q: string, maxResults: number): Promise<BookRecord[]> => {
    const url = new URL("https://books.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("printType", "books");
    if (options.googleApiKey) url.searchParams.set("key", options.googleApiKey);
    const response = googleResults.safeParse(await getJson(url, service, options));
    if (!response.success) throw new Error(`${service} returned invalid book data.`);
    return response.data.items.flatMap((candidate) => {
      const result = googleVolume.safeParse(candidate);
      if (!result.success) return [];
      const book = result.data.volumeInfo;
      return [
        stripUndefined({
          title: book.title,
          subtitle: book.subtitle,
          authors: book.authors ?? [],
          isbns: isbnList(
            book.industryIdentifiers
              .filter(({ type }) => /^ISBN_(10|13)$/.test(type))
              .map(({ identifier }) => identifier),
          ),
          publisher: book.publisher,
          publishedDate: book.publishedDate,
          pageCount: book.pageCount,
          language: book.language,
          description: book.description,
          coverUrl: httpsUrl(book.imageLinks?.thumbnail ?? book.imageLinks?.smallThumbnail),
          infoUrl: httpsUrl(book.infoLink),
          source: "google-books" as const,
        }),
      ];
    });
  };
  // Google's field operators take quoted phrases; quotes inside a value would end the phrase early.
  const phrase = (value: string) => `"${value.replaceAll('"', " ").trim()}"`;
  return {
    id: "google-books",
    async byIsbn(value) {
      const { isbn, canonical } = requireIsbn(value);
      // Google can return near matches; keep only volumes that carry this exact edition.
      const matches = (await volumes(`isbn:${isbn}`, 10)).filter((book) => book.isbns.includes(canonical));
      const best = matches.find((book) => book.authors.length) ?? matches[0];
      return best ? { ...best, isbns: isbnList(best.isbns, canonical) } : null;
    },
    async search(query, limit = 10) {
      const { title, author, text } = requireQuery(query);
      const terms = [text, title && `intitle:${phrase(title)}`, author && `inauthor:${phrase(author)}`].filter(
        (term): term is string => !!term,
      );
      return volumes(terms.join(" "), resultLimit(limit));
    },
  };
}

/** The same book from two services: a shared ISBN, or the same title and first author. */
function sameBook(left: BookRecord, right: BookRecord): boolean {
  if (left.isbns.some((isbn) => right.isbns.includes(isbn))) return true;
  const author = (book: BookRecord) => (book.authors[0] ? normalizeName(book.authors[0]) : "");
  return (
    normalizeTitle(left.title, true) === normalizeTitle(right.title, true) &&
    author(left) !== "" &&
    author(left) === author(right)
  );
}

/**
 * Combine sources, in order. An ISBN lookup tries each until one names an author, falling back to an
 * authorless result, and fails only when every source failed. A search fills up to `limit` from each
 * source in turn, skipping books an earlier source already returned.
 */
export function createBookMetadata(
  sources: readonly BookMetadataSource[] = [],
  options: BookMetadataOptions = {},
): BookMetadataSource {
  const chain = sources.length ? sources : [createOpenLibrarySource(options), createGoogleBooksSource(options)];
  return {
    id: "combined",
    async byIsbn(isbn) {
      requireIsbn(isbn);
      const errors: string[] = [];
      let incomplete: BookRecord | null = null;
      for (const source of chain) {
        try {
          const book = await source.byIsbn(isbn);
          if (book?.authors.length) return book;
          incomplete ??= book;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (incomplete) return incomplete;
      if (errors.length) throw new Error(errors.join(" "));
      return null;
    },
    async search(query, limit = 10) {
      requireQuery(query);
      const wanted = resultLimit(limit);
      const errors: string[] = [];
      const books: BookRecord[] = [];
      for (const source of chain) {
        if (books.length >= wanted) break;
        try {
          for (const book of await source.search(query, wanted)) {
            if (books.length < wanted && !books.some((known) => sameBook(known, book))) books.push(book);
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (!books.length && errors.length === chain.length) throw new Error(errors.join(" "));
      return books;
    },
  };
}
