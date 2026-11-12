import type { Config } from "./config.js";
import { ConfigError, HttpError } from "./errors.js";
import { sleep } from "./http.js";
import type { BookRequest } from "./input.js";
import type { LibbyClient } from "./libby-client.js";
import type { Logger } from "./logger.js";
import { bestMatch } from "./matcher.js";
import { type Candidate, type Plan, type RunState, planBook } from "./planner.js";
import type { ThunderClient } from "./thunder-client.js";
import type { LibbyCard, SyncResponse, ThunderMedia } from "./types.js";
import { stripUndefined } from "./util.js";

export type ResultStatus = "borrowed" | "held" | "would-borrow" | "would-hold" | "skipped" | "error";

/** One row of the report. A book with holds at several libraries yields several rows. */
export interface BookResult {
  input: string;
  status: ResultStatus;
  message?: string;
  titleId?: string;
  title?: string;
  author?: string;
  mediaType?: string;
  library?: string;
  cardId?: string;
  cardName?: string;
  loanDays?: number;
  estimatedWaitDays?: number;
  holdsCount?: number;
}

export interface RunnerDeps {
  libby: LibbyClient;
  thunder: ThunderClient;
  logger: Logger;
}

export class Runner {
  private searchCache = new Map<string, ThunderMedia[]>();

  constructor(
    private readonly cfg: Config,
    private readonly deps: RunnerDeps,
  ) {}

  /** Processes every book in order. `onResult` streams rows as they finish. */
  async run(books: BookRequest[], onResult?: (r: BookResult) => void): Promise<BookResult[]> {
    const { logger } = this.deps;
    const sync = await this.deps.libby.sync();
    const cards = selectCards(sync.cards ?? [], this.cfg);
    logger.info(`Using ${cards.length} card(s): ${cards.map(cardLabel).join(", ")}`);
    const state = initialState(sync, cards);
    const results: BookResult[] = [];
    const emit = (r: BookResult) => {
      results.push(r);
      onResult?.(r);
    };

    for (const [i, book] of books.entries()) {
      if (i > 0 && this.cfg.delayMs) await sleep(this.cfg.delayMs);
      logger.info(`[${i + 1}/${books.length}] ${book.raw}`);
      try {
        for (const r of await this.processBook(book, cards, state)) emit(r);
      } catch (e) {
        if (e instanceof HttpError && e.isAuthError) throw e; // token invalid: abort
        if (this.cfg.failFast) throw e;
        emit({ input: book.raw, status: "error", message: (e as Error).message });
      }
    }
    return results;
  }

  /** Finds candidates and the plan without acting. Exposed for `search`/debugging. */
  async findCandidates(book: BookRequest, cards: LibbyCard[]): Promise<Candidate[]> {
    const libs = orderedLibraries(cards, book.libraries);
    const out: Candidate[] = [];
    for (const lib of libs) {
      const items = await this.search(lib, book);
      const match = bestMatch(book, items, { ...this.cfg.matching, mediaTypes: this.cfg.mediaTypes });
      if (!match) continue;
      for (const card of cards.filter((c) => c.advantageKey === lib)) out.push({ card, match });
    }
    return out;
  }

  private async processBook(book: BookRequest, cards: LibbyCard[], state: RunState): Promise<BookResult[]> {
    const candidates = await this.findCandidates(book, cards);
    let plan = planBook(book, candidates, state, this.cfg);
    this.deps.logger.debug(`plan: ${describePlan(plan)}`);
    if (this.cfg.dryRun) return planToResults(book, plan, true);

    if (plan.kind === "borrow") {
      try {
        await this.deps.libby.borrow({
          cardId: plan.card.cardId,
          titleId: plan.media.id,
          mediaType: plan.media.type?.id ?? "ebook",
          days: plan.days,
          luckyDay: plan.luckyDay,
        });
        bump(state, plan.card.cardId, "loan");
        state.loanTitleIds.add(plan.media.id);
        state.borrowsThisRun++;
        return planToResults(book, plan, false);
      } catch (e) {
        const auto = (book.action ?? this.cfg.action) === "auto";
        if (!auto || !(e instanceof HttpError) || e.isAuthError) throw e;
        this.deps.logger.warn(`Borrow failed (${e.message}); trying a hold instead.`);
        plan = planBook({ ...book, action: "hold" }, candidates, state, this.cfg);
      }
    }

    if (plan.kind === "hold") {
      const done: BookResult[] = [];
      for (const t of plan.targets) {
        try {
          await this.deps.libby.placeHold({
            cardId: t.card.cardId,
            titleId: t.media.id,
            ...(this.cfg.hold.emailAddress ? { emailAddress: this.cfg.hold.emailAddress } : {}),
          });
        } catch (e) {
          if (e instanceof HttpError && e.isAuthError) throw e;
          done.push({ ...rowFor(book, t.card, t.media), status: "error", message: (e as Error).message });
          continue;
        }
        bump(state, t.card.cardId, "hold");
        state.holdTitleIds.add(t.media.id);
        state.holdsThisRun++;
        let message: string | undefined;
        if (this.cfg.hold.suspendDays > 0) {
          try {
            await this.deps.libby.suspendHold({ cardId: t.card.cardId, titleId: t.media.id, days: this.cfg.hold.suspendDays });
            message = `suspended ${this.cfg.hold.suspendDays} days`;
          } catch (e) {
            message = `hold placed; suspend failed: ${(e as Error).message}`;
          }
        }
        done.push({ ...rowFor(book, t.card, t.media), status: "held", ...(message ? { message } : {}) });
      }
      return done;
    }
    return planToResults(book, plan, false);
  }

  private async search(libraryKey: string, book: BookRequest): Promise<ThunderMedia[]> {
    const key = `${libraryKey}\u0000${book.titleId ?? ""}\u0000${book.isbn ?? ""}\u0000${book.title ?? ""}\u0000${book.author ?? ""}`;
    const hit = this.searchCache.get(key);
    if (hit) return hit;
    const { thunder } = this.deps;
    const mediaTypes = book.mediaTypes?.length ? book.mediaTypes : this.cfg.mediaTypes;
    let items: ThunderMedia[] = [];
    if (book.titleId) {
      try {
        items = [await thunder.getLibraryMedia(libraryKey, book.titleId)];
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    } else {
      const perPage = this.cfg.matching.perPage;
      if (book.isbn) items = await thunder.searchLibrary(libraryKey, { identifier: book.isbn, mediaTypes, perPage });
      if (!items.length && book.title) {
        const query = [book.title, book.author].filter(Boolean).join(" ");
        items = await thunder.searchLibrary(libraryKey, { query, mediaTypes, perPage });
      }
    }
    this.searchCache.set(key, items);
    return items;
  }
}

/** Filters cards by `cfg.cards`, then orders/filters by `cfg.libraries`. */
export function selectCards(all: LibbyCard[], cfg: Pick<Config, "cards" | "libraries">): LibbyCard[] {
  if (!all.length) throw new ConfigError("Libby account has no library cards.");
  const wanted = cfg.cards.map((c) => c.toLowerCase());
  let cards = wanted.length
    ? all.filter((c) => wanted.includes(c.cardId.toLowerCase()) || wanted.includes((c.cardName ?? "").toLowerCase()))
    : all;
  if (cfg.libraries.length) {
    const order = cfg.libraries.map((l) => l.toLowerCase());
    cards = cards
      .filter((c) => order.includes(c.advantageKey.toLowerCase()))
      .sort((a, b) => order.indexOf(a.advantageKey.toLowerCase()) - order.indexOf(b.advantageKey.toLowerCase()));
  }
  if (!cards.length) {
    throw new ConfigError(
      `No cards match the configured cards/libraries. Available: ${all.map(cardLabel).join(", ")}`,
    );
  }
  return cards;
}

export function initialState(sync: SyncResponse, cards: LibbyCard[]): RunState {
  const counts = new Map<string, { loan: number; hold: number }>();
  for (const c of cards) {
    counts.set(c.cardId, {
      loan: c.counts?.loan ?? (sync.loans ?? []).filter((l) => l.cardId === c.cardId).length,
      hold: c.counts?.hold ?? (sync.holds ?? []).filter((h) => h.cardId === c.cardId).length,
    });
  }
  return {
    counts,
    loanTitleIds: new Set((sync.loans ?? []).map((l) => String(l.id))),
    holdTitleIds: new Set((sync.holds ?? []).map((h) => String(h.id))),
    borrowsThisRun: 0,
    holdsThisRun: 0,
  };
}

function orderedLibraries(cards: LibbyCard[], only?: string[]): string[] {
  const libs = [...new Set(cards.map((c) => c.advantageKey))];
  if (!only?.length) return libs;
  const o = only.map((l) => l.toLowerCase());
  return libs.filter((l) => o.includes(l.toLowerCase()));
}

function bump(state: RunState, cardId: string, kind: "loan" | "hold") {
  const c = state.counts.get(cardId) ?? { loan: 0, hold: 0 };
  c[kind]++;
  state.counts.set(cardId, c);
}

function rowFor(book: BookRequest, card: LibbyCard, media: ThunderMedia): Omit<BookResult, "status"> {
  return stripUndefined({
    input: book.raw,
    titleId: media.id,
    title: media.title,
    author: media.firstCreatorName,
    mediaType: media.type?.id,
    library: card.advantageKey,
    cardId: card.cardId,
    cardName: card.cardName,
    estimatedWaitDays: media.estimatedWaitDays,
    holdsCount: media.holdsCount,
  });
}

function planToResults(book: BookRequest, plan: Plan, dry: boolean): BookResult[] {
  switch (plan.kind) {
    case "borrow":
      return [
        {
          ...rowFor(book, plan.card, plan.media),
          status: dry ? "would-borrow" : "borrowed",
          loanDays: plan.days,
          ...(plan.luckyDay ? { message: "lucky day copy" } : {}),
        },
      ];
    case "hold":
      return plan.targets.map((t) => ({ ...rowFor(book, t.card, t.media), status: dry ? "would-hold" : "held" }));
    case "skip":
      return [
        stripUndefined({
          input: book.raw,
          status: "skipped" as const,
          message: plan.reason,
          titleId: plan.media?.id,
          title: plan.media?.title,
          author: plan.media?.firstCreatorName,
          mediaType: plan.media?.type?.id,
        }),
      ];
  }
}

function describePlan(p: Plan): string {
  if (p.kind === "borrow") return `borrow ${p.media.id} on ${p.card.advantageKey} for ${p.days}d`;
  if (p.kind === "hold") return `hold ${p.targets.map((t) => `${t.media.id}@${t.card.advantageKey}`).join(", ")}`;
  return `skip (${p.reason})`;
}

export function cardLabel(c: LibbyCard): string {
  return `${c.advantageKey}${c.cardName ? ` (${c.cardName})` : ""}`;
}
