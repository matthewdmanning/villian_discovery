import type { BookRequest } from "../../../src/input.ts";
import type { BookResult, ResultStatus } from "../../../src/runner.ts";
import type { LibbyCard, ThunderMedia } from "../../../src/types.ts";
import type { Config } from "./config.ts";

/** One `search` row: what a card's library would match. */
export interface Match {
  card: LibbyCard;
  media: ThunderMedia;
  titleScore: number;
  authorScore?: number;
}

/**
 * What the UI needs from libby-shelf. Each method mirrors one CLI command.
 * A local server can implement this over the library; `demoApi` fakes it in the browser.
 */
export interface LibbyApi {
  readonly demo: boolean;
  status(tokenFile: string): Promise<{ connected: boolean }>;
  login(code: string, tokenFile: string): Promise<void>;
  cards(): Promise<LibbyCard[]>;
  search(book: BookRequest, config: Config): Promise<Match[]>;
  run(books: BookRequest[], config: Config): Promise<BookResult[]>;
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
  },
  {
    cardId: "1002",
    cardName: "Branch",
    advantageKey: "lib2",
    limits: { loan: 5, hold: 5 },
    counts: { loan: 0, hold: 5 },
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
    id: String(5_000_000 + Math.floor(r * 999_999)),
    title: book.title ?? (book.isbn ? `ISBN ${book.isbn}` : `Title ${book.titleId}`),
    firstCreatorName: book.author ?? "Unknown",
    type: { id: type },
    isAvailable: available > 0,
    ownedCopies: owned,
    availableCopies: Math.min(available, owned),
    holdsCount: available ? 0 : Math.floor(r * 40),
    estimatedWaitDays: available ? 0 : 7 + Math.floor(r * 60),
  };
}

function cardsFor(config: Config, book?: BookRequest): LibbyCard[] {
  const keys = book?.libraries?.length ? book.libraries : config.libraries;
  const chosen = config.cards.length
    ? CARDS.filter((c) => config.cards.includes(c.cardId) || config.cards.includes(c.cardName ?? ""))
    : CARDS;
  if (!keys.length) return chosen;
  return keys.flatMap((k) => chosen.filter((c) => c.advantageKey === k));
}

function full(card: LibbyCard, kind: "loan" | "hold"): boolean {
  const limit = card.limits?.[kind];
  return limit !== undefined && (card.counts?.[kind] ?? 0) >= limit;
}

export const demoApi: LibbyApi = {
  demo: true,
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
    return cardsFor(config, book).flatMap((card) =>
      (book.mediaTypes ?? config.mediaTypes).slice(0, 1).map((type) => {
        const media = fakeMedia(book, card, type);
        const r = seeded(media.id);
        return {
          card,
          media,
          titleScore: book.titleId || book.isbn ? 1 : 0.86 + r * 0.14,
          ...(book.author && { authorScore: 0.6 + r * 0.4 }),
        };
      }),
    );
  },
  async run(books, config) {
    await wait(700);
    const out: BookResult[] = [];
    for (const book of books) {
      const action = book.action ?? config.action;
      const type = (book.mediaTypes ?? config.mediaTypes)[0] ?? "ebook";
      const cards = cardsFor(config, book);
      const base = {
        input: book.raw,
        ...(book.title && { title: book.title }),
        ...(book.author && { author: book.author }),
      };
      if (!cards.length) {
        out.push({ ...base, status: "error", message: "No matching card" });
        continue;
      }
      if (config.skipExisting && seeded(book.raw) < 0.12) {
        out.push({ ...base, status: "skipped", message: "Already on shelf" });
        continue;
      }
      const hits = cards.map((card) => ({ card, media: fakeMedia(book, card, type) }));
      const now = hits.find((h) => h.media.isAvailable && !(config.respectCardLimits && full(h.card, "loan")));
      const row = (h: (typeof hits)[number], status: ResultStatus, extra: Partial<BookResult> = {}): BookResult => ({
        ...base,
        status,
        titleId: h.media.id,
        title: h.media.title,
        mediaType: type,
        library: h.card.advantageKey,
        cardId: h.card.cardId,
        ...(h.card.cardName && { cardName: h.card.cardName }),
        ...extra,
      });
      if (action !== "hold" && now) {
        out.push(row(now, config.dryRun ? "would-borrow" : "borrowed", { loanDays: 14 }));
        continue;
      }
      if (action === "borrow") {
        out.push({ ...base, status: "skipped", message: "No copy available" });
        continue;
      }
      const holdable = hits
        .filter((h) => !(config.respectCardLimits && full(h.card, "hold")))
        .filter(
          (h) =>
            config.hold.maxEstimatedWaitDays === undefined ||
            (h.media.estimatedWaitDays ?? 0) <= config.hold.maxEstimatedWaitDays,
        )
        .filter(
          (h) => config.hold.maxHoldsCount === undefined || (h.media.holdsCount ?? 0) <= config.hold.maxHoldsCount,
        );
      if (!holdable.length) {
        out.push({ ...base, status: "skipped", message: "No card can hold it" });
        continue;
      }
      const placement = config.hold.placement;
      const targets =
        placement === "all"
          ? holdable
          : placement === "first"
            ? holdable.slice(0, 1)
            : [
                holdable.reduce((a, b) =>
                  (b.media.estimatedWaitDays ?? 0) < (a.media.estimatedWaitDays ?? 0) ? b : a,
                ),
              ];
      for (const h of targets) {
        out.push(
          row(h, config.dryRun ? "would-hold" : "held", {
            ...(h.media.estimatedWaitDays !== undefined && { estimatedWaitDays: h.media.estimatedWaitDays }),
            ...(h.media.holdsCount !== undefined && { holdsCount: h.media.holdsCount }),
          }),
        );
      }
    }
    return out;
  },
};

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
