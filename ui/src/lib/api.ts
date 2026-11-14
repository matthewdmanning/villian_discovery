import type { BookRequest } from "../../../src/input.js";
import { LibbyClient } from "../../../src/libby-client.js";
import { silentLogger } from "../../../src/logger.js";
import type { BookResult, ResultStatus } from "../../../src/runner.js";
import { Runner, selectCards } from "../../../src/runner.js";
import { reconcileSnapshots, type SyncField } from "../../../src/sync.js";
import { ThunderClient } from "../../../src/thunder-client.js";
import type { LibbyCard, ThunderMedia } from "../../../src/types.js";
import type { Config } from "./config.ts";

/** One `search` row: what a card's library would match. */
export interface Match {
  card: LibbyCard;
  media: ThunderMedia;
  titleScore: number;
  authorScore?: number;
}

/**
 * What the UI needs from library operations and cross-service reconciliation.
 * A local server can implement this over the library; `demoApi` fakes it in the browser.
 */
export interface LibraryApi {
  readonly demo: boolean;
  status(tokenFile: string): Promise<{ connected: boolean }>;
  login(code: string, tokenFile: string): Promise<void>;
  cards(): Promise<LibbyCard[]>;
  search(book: BookRequest, config: Config): Promise<Match[]>;
  run(books: BookRequest[], config: Config): Promise<BookResult[]>;
  sync(): Promise<SyncField[]>;
}

export type { BookRequest, BookResult, LibbyCard, ResultStatus };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CARDS: LibbyCard[] = [
  {
    cardId: "1001",
    cardName: "Main",
    advantageKey: "lib1",
    limits: { loan: 10, hold: 10 },
    counts: { loan: 3, hold: 7 },
    lendingPeriods: {
      book: {
        options: [
          [7, "days"],
          [14, "days"],
          [21, "days"],
        ],
        preference: [14, "days"],
      },
      audiobook: {
        options: [
          [7, "days"],
          [14, "days"],
        ],
        preference: [7, "days"],
      },
    },
  },
  {
    cardId: "1002",
    cardName: "Branch",
    advantageKey: "lib2",
    limits: { loan: 5, hold: 5 },
    counts: { loan: 0, hold: 5 },
    lendingPeriods: {
      book: {
        options: [
          [7, "days"],
          [14, "days"],
        ],
        preference: [7, "days"],
      },
      audiobook: {
        options: [
          [7, "days"],
          [14, "days"],
        ],
        preference: [14, "days"],
      },
    },
  },
];

/** Stable pseudo-random number in [0, 1) per string, so demo output is repeatable. */
function seeded(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

function fakeMedia(book: BookRequest, card: LibbyCard, type: string): ThunderMedia {
  const r = seeded(`${book.raw}|${card.advantageKey}|${type}`);
  const owned = 1 + Math.floor(r * 6);
  const available = r > 0.55 ? Math.ceil((r - 0.55) * 4) : 0;
  return {
    id: book.titleId ?? String(5_000_000 + Math.floor(r * 999_999)),
    title: book.title ?? (book.isbn ? `ISBN ${book.isbn}` : `Title ${book.titleId}`),
    firstCreatorName: book.author ?? "Unknown",
    type: { id: type },
    isAvailable: available > 0,
    ownedCopies: owned,
    availableCopies: Math.min(available, owned),
    holdsCount: available ? 0 : Math.floor(r * 40),
    estimatedWaitDays: available ? 0 : 7 + Math.floor(r * 60),
    ...(book.isbn && {
      formats: [{ id: `${type}-demo`, identifiers: [{ type: "ISBN", value: book.isbn }] }],
    }),
  };
}

export const demoApi: LibraryApi = {
  demo: true,
  /** Use this method to preview reconciliation with deterministic example snapshots through reconcileSnapshots. */
  async sync() {
    await wait(400);
    return reconcileSnapshots(
      [
        {
          bookId: "isbn:9781635575637",
          title: "Piranesi",
          fields: {
            readingProgress: { value: 45, updatedAt: "2026-11-10T10:00:00Z" },
            checkedOut: { value: true },
            finished: { value: false },
            rating: { value: 4, updatedAt: "2026-11-10T10:00:00Z" },
            notes: { value: "Read the ending again", updatedAt: "2026-11-13T10:00:00Z" },
            shelves: { value: ["Favorites"], updatedAt: "2026-11-12T10:00:00Z" },
          },
        },
        {
          bookId: "isbn:9780441172719",
          title: "Dune",
          fields: { readingProgress: { value: 100 }, checkedOut: { value: false }, finished: { value: true } },
        },
      ],
      [
        {
          bookId: "isbn:9781635575637",
          title: "Piranesi",
          fields: {
            readingProgress: { value: 80, updatedAt: "2026-11-14T10:00:00Z" },
            checkedOut: { value: false },
            finished: { value: true },
            rating: { value: 5, updatedAt: "2026-11-13T10:00:00Z" },
            notes: { value: "Read with the book club", updatedAt: "2026-11-10T10:00:00Z" },
            shelves: { value: ["Book club"], updatedAt: "2026-11-12T10:00:00Z" },
          },
        },
        {
          bookId: "isbn:9780441172719",
          title: "Dune",
          fields: {
            readingProgress: { value: 20 },
            checkedOut: { value: false },
            finished: { value: false },
            notes: { value: "Discuss at next meeting", updatedAt: "2026-11-13T10:00:00Z" },
          },
        },
      ],
    );
  },
  async status() {
    await wait(150);
    return { connected: sessionStorageGet("demo-connected") === "1" };
  },
  async login(code) {
    await wait(600);
    if (!/^\d{8}$/.test(code)) throw new Error("Setup code must be 8 digits");
    sessionStorageSet("demo-connected", "1");
  },
  async cards() {
    await wait(250);
    return CARDS;
  },
  async search(book, config) {
    await wait(500);
    const runner = createDemoRunner(config, [book]);
    return (await runner.findCandidates(book, selectCards(CARDS, config))).map(({ card, match }) => ({
      card,
      media: match.media,
      titleScore: match.titleScore,
      ...(match.authorScore !== undefined && { authorScore: match.authorScore }),
    }));
  },
  async run(books, config) {
    await wait(700);
    return createDemoRunner(config, books).run(books);
  },
};

/** Use this function to create the production runner with deterministic demo HTTP responses for a run. Inputs are the resolved UI config and all books used to seed the request transport; dependencies are `LibbyClient`, `ThunderClient`, and `Runner`. */
function createDemoRunner(config: Config, books: BookRequest[]): Runner {
  const fetch = demoFetch(config, books);
  const http = { ...config.http, fetch, logger: silentLogger };
  return new Runner(config, {
    libby: new LibbyClient({ ...http, identityToken: "demo" }),
    thunder: new ThunderClient(http),
    logger: silentLogger,
  });
}

/** Use this function to answer the runner's Libby and Thunder requests with deterministic in-memory demo data. Inputs are the resolved UI config and all books used to select fake media; dependencies are `CARDS` and `fakeMedia`. */
function demoFetch(config: Config, books: BookRequest[]): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chip/sync")) {
      return Response.json({ result: "synchronized", cards: CARDS, loans: [], holds: [] });
    }
    if (url.pathname.includes("/libraries/") && url.pathname.endsWith("/media")) {
      const library = url.pathname.split("/").at(-2);
      const card = CARDS.find((candidate) => candidate.advantageKey === library);
      const query = url.searchParams.get("query") ?? "";
      const identifier = url.searchParams.get("identifier");
      const book = books.find(
        (candidate) =>
          (identifier !== null && candidate.isbn === identifier) ||
          (!!candidate.title && query === [candidate.title, candidate.author].filter(Boolean).join(" ")),
      );
      if (!card || !book) return Response.json({ items: [] });
      const mediaTypes = (url.searchParams.get("mediaTypes")?.split(",").filter(Boolean) ?? config.mediaTypes).filter(
        (type) => type === "ebook" || type === "audiobook" || type === "magazine",
      );
      return Response.json({ items: mediaTypes.map((type) => fakeMedia(book, card, type)) });
    }
    if (url.pathname.includes("/libraries/") && url.pathname.includes("/media/")) {
      const library = url.pathname.split("/").at(-3);
      const card = CARDS.find((candidate) => candidate.advantageKey === library);
      const titleId = url.pathname.split("/").at(-1);
      const book = books.find((candidate) => candidate.titleId === titleId);
      if (!card || !book) return Response.json({}, { status: 404 });
      return Response.json(fakeMedia(book, card, book.mediaTypes?.[0] ?? config.mediaTypes[0] ?? "ebook"));
    }
    if (init.method === "POST" || init.method === "PUT") return Response.json({});
    throw new Error(`Unsupported demo request: ${init.method ?? "GET"} ${url.pathname}`);
  };
}

function sessionStorageGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function sessionStorageSet(k: string, v: string) {
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* private mode: demo stays disconnected */
  }
}
