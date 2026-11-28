/**
 * Public book metadata for books that Libby or Fable already returned: one interface, `BookMetadataSource`,
 * with an Open Library and a Google Books implementation, and a combined source that falls back between them.
 * It resolves and checks ISBNs; it is not a search engine. Requests send only the ISBN being checked, with no
 * cookies or referrer.
 */
import { z } from "zod";
import { normalizeIsbn } from "./input.js";
import { stripUndefined } from "./util.js";

export type BookMetadataSourceId = "open-library" | "google-books";

/** One edition as a metadata service describes it. */
export interface BookRecord {
  title: string;
  subtitle?: string;
  authors: string[];
  /** ISBN-13s of this edition, the looked-up one first. */
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

export type EditionFormat = "audiobook" | "ebook" | "print";

/** One edition of a work: its ISBN-13 and, when the service knows it, its format. */
export interface Edition {
  isbn: string;
  format?: EditionFormat;
}

export interface BookMetadataSource {
  readonly id: BookMetadataSourceId | "combined";
  /** Resolve an ISBN-10 or ISBN-13 to its book: title, authors and other details. Null when unknown. */
  byIsbn(isbn: string): Promise<BookRecord | null>;
  /**
   * Every known edition of the same work as `isbn`, that ISBN included, so two ISBNs can be checked as the
   * same book in different editions. Only the looked-up edition when the service has no work grouping.
   */
  editions(isbn: string): Promise<Edition[]>;
}

/** Resolve one ISBN to its book; the shape `LibraryApi.lookupIsbn` exposes to the UI. */
export type IsbnLookup = (isbn: string) => Promise<BookRecord | null>;

export interface BookMetadataOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Optional Google Books API key; without one, Google's shared keyless quota applies. */
  googleApiKey?: string;
}

const MAX_ISBNS = 40;
const MAX_EDITIONS = 500;
const CACHED_ISBNS = 500;

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
const openLibraryIsbn = z.object({ works: z.array(z.object({ key: z.string().regex(/^\/works\/OL\d+W$/) })).min(1) });
const openLibraryEditions = z.object({
  entries: z
    .array(
      z.object({
        isbn_13: z.array(z.string()).optional(),
        isbn_10: z.array(z.string()).optional(),
        physical_format: z.string().optional(),
      }),
    )
    .default([]),
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

/** An edition's format from a service's label: "eAudiobook", "Audio CD", "ebook", "Kindle", "Paperback"… */
export function editionFormat(label: string | undefined): EditionFormat | undefined {
  if (!label) return undefined;
  if (/audio|\bcd\b|mp3|cassette/i.test(label)) return "audiobook";
  if (/e-?book|kindle|epub|electronic/i.test(label)) return "ebook";
  if (/paperback|hardcover|hardback|mass market|board book|library binding|print/i.test(label)) return "print";
  return undefined;
}

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
    async editions(value) {
      const { canonical } = requireIsbn(value);
      // The edition record names its work; the work lists every edition with its ISBNs and format.
      const edition = openLibraryIsbn.safeParse(
        await getJson(new URL(`https://openlibrary.org/isbn/${canonical}.json`), service, options).catch((error) => {
          if (error instanceof Error && error.message.endsWith("HTTP 404.")) return null;
          throw error;
        }),
      );
      if (!edition.success) return [{ isbn: canonical }];
      const url = new URL(`https://openlibrary.org${edition.data.works[0]!.key}/editions.json`);
      url.searchParams.set("limit", String(MAX_EDITIONS));
      const listed = openLibraryEditions.safeParse(await getJson(url, service, options));
      if (!listed.success) throw new Error(`${service} returned invalid edition data.`);
      const editions = new Map<string, Edition>([[canonical, { isbn: canonical }]]);
      for (const entry of listed.data.entries) {
        const format = editionFormat(entry.physical_format);
        for (const isbn of isbnList([...(entry.isbn_13 ?? []), ...(entry.isbn_10 ?? [])])) {
          if (!editions.has(isbn) || (format && !editions.get(isbn)!.format))
            editions.set(isbn, { isbn, ...(format ? { format } : {}) });
        }
      }
      return [...editions.values()];
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
  const byIsbn = async (value: string): Promise<BookRecord | null> => {
    const { isbn, canonical } = requireIsbn(value);
    // Google can return near matches; keep only volumes that carry this exact edition.
    const matches = (await volumes(`isbn:${isbn}`, 10)).filter((book) => book.isbns.includes(canonical));
    const best = matches.find((book) => book.authors.length) ?? matches[0];
    return best ? { ...best, isbns: isbnList(best.isbns, canonical) } : null;
  };
  return {
    id: "google-books",
    byIsbn,
    async editions(value) {
      // Google Books has no work grouping: a volume lists only its own ISBN-10 and ISBN-13.
      const { canonical } = requireIsbn(value);
      return isbnList((await byIsbn(value))?.isbns ?? [], canonical).map((isbn) => ({ isbn }));
    },
  };
}

/**
 * Combine sources, in order (default: Open Library, then Google Books). An ISBN lookup tries each until one
 * names an author, falling back to an authorless result, and fails only when no source answered. Editions come
 * from the first source that answers, so Google Books, which has no work grouping, is asked only when Open
 * Library fails. Successful answers are cached per ISBN.
 */
export function createBookMetadata(
  sources: readonly BookMetadataSource[] = [],
  options: BookMetadataOptions = {},
): BookMetadataSource {
  const chain = sources.length ? sources : [createOpenLibrarySource(options), createGoogleBooksSource(options)];
  const books = boundedCache<BookRecord | null>();
  const editionLists = boundedCache<Edition[]>();
  return {
    id: "combined",
    async byIsbn(isbn) {
      const { canonical } = requireIsbn(isbn);
      return books(canonical, async () => {
        const errors: string[] = [];
        let incomplete: BookRecord | null = null;
        for (const source of chain) {
          try {
            const book = await source.byIsbn(canonical);
            if (book?.authors.length) return book;
            incomplete ??= book;
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        if (incomplete) return incomplete;
        if (errors.length) throw new Error(errors.join(" "));
        return null;
      });
    },
    async editions(isbn) {
      const { canonical } = requireIsbn(isbn);
      return editionLists(canonical, async () => {
        const errors: string[] = [];
        for (const source of chain) {
          try {
            return await source.editions(canonical);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        throw new Error(errors.join(" "));
      });
    },
  };
}

/** Keep up to `CACHED_ISBNS` answers, oldest dropped first. A failed lookup is never kept. */
function boundedCache<T>(): (key: string, load: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, Promise<T>>();
  return (key, load) => {
    const known = entries.get(key);
    if (known) return known;
    const value = load();
    entries.set(key, value);
    if (entries.size > CACHED_ISBNS) entries.delete(entries.keys().next().value!);
    value.catch(() => {
      if (entries.get(key) === value) entries.delete(key);
    });
    return value;
  };
}
