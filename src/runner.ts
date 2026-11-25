import { type Config, MediaTypeSchema } from "./config.js";
import { ConfigError, HttpError, MutationUncertainError } from "./errors.js";
import { sleep } from "./http.js";
import type { BookRequest } from "./input.js";
import type { LibbyClient } from "./libby-client.js";
import type { Logger } from "./logger.js";
import { bestMatch, mediaAuthors, normalizeTitle, rankedMatches } from "./matcher.js";
import { type Candidate, type Plan, planBook, type RunState } from "./planner.js";
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
        await this.processBook(book, cards, state, emit);
      } catch (e) {
        if (e instanceof MutationUncertainError || (e instanceof HttpError && e.isAuthError)) throw e;
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
      const matches = rankedMatches(book, items, { ...this.cfg.matching, mediaTypes: this.cfg.mediaTypes });
      for (const match of matches) {
        for (const card of cards.filter((c) => c.advantageKey === lib)) out.push({ card, match });
      }
    }
    return out;
  }

  /** Use this function to list what each card's library would match for a book, as flat `search` rows. */
  async searchMatches(book: BookRequest, cards: LibbyCard[]) {
    const { isbn, title, author, ...request } = book;
    let candidates: Candidate[];
    if (isbn && !book.titleId) {
      const mediaTypes = request.mediaTypes?.length ? request.mediaTypes : this.cfg.mediaTypes;
      const identifierTypes = [...new Set([...mediaTypes, ...MediaTypeSchema.options])];
      const exact = await this.findCandidates({ ...request, isbn, mediaTypes: identifierTypes }, cards);
      candidates = exact.filter(
        ({ match }) => !match.media.type || mediaTypes.some((type) => type === match.media.type?.id),
      );
      const seed = (candidates[0] ?? exact[0])?.match.media;
      const resolvedTitle = title ?? seed?.title;
      const resolvedAuthor = author ?? (seed && mediaAuthors(seed)[0]);
      if (resolvedTitle) {
        const titleKey = normalizeTitle(resolvedTitle, false);
        const editions = await this.findCandidates(
          { ...request, title: resolvedTitle, ...(resolvedAuthor && { author: resolvedAuthor }) },
          cards,
        );
        const seen = new Set(candidates.map(({ card, match }) => JSON.stringify([card.cardId, match.media.id])));
        for (const edition of editions) {
          const { card, match } = edition;
          if (normalizeTitle(match.media.title, false) !== titleKey) continue;
          const key = JSON.stringify([card.cardId, match.media.id]);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push(edition);
        }
      }
    } else {
      candidates = await this.findCandidates(book, cards);
    }
    return candidates.map(({ card, match }) => ({
      card,
      media: match.media,
      titleScore: match.titleScore,
      ...(match.authorScore !== undefined && { authorScore: match.authorScore }),
    }));
  }

  private async processBook(
    book: BookRequest,
    cards: LibbyCard[],
    state: RunState,
    emit: (row: BookResult) => void,
  ): Promise<void> {
    const candidates = await this.findCandidates(book, cards);
    let plan = planBook(book, candidates, state, this.cfg);
    this.deps.logger.debug(`plan: ${describePlan(plan)}`);
    if (this.cfg.dryRun) {
      applyPlan(state, plan);
      for (const row of planToResults(book, plan, true)) emit(row);
      return;
    }

    if (plan.kind === "borrow") {
      let borrowed = false;
      try {
        await this.deps.libby.borrow({
          cardId: plan.card.cardId,
          titleId: plan.media.id,
          mediaType: plan.media.type?.id ?? "ebook",
          days: plan.days,
          luckyDay: plan.luckyDay,
        });
        borrowed = true;
      } catch (error) {
        borrowed = await this.reconcileWrite("loan", plan.card.cardId, plan.media.id, error);
        if (!borrowed) {
          const auto = (book.action ?? this.cfg.action) === "auto";
          const unavailable = error instanceof HttpError && error.errorCode === "TitleNoLongerAvailable";
          if (!auto || !unavailable || this.cfg.failFast) throw error;
          this.deps.logger.warn("Title no longer available; trying a hold instead.");
          plan = planBook({ ...book, action: "hold" }, candidates, state, this.cfg);
        }
      }
      if (borrowed) {
        applyPlan(state, plan);
        for (const row of planToResults(book, plan, false)) emit(row);
        return;
      }
    }

    if (plan.kind === "hold") {
      for (const target of plan.targets) {
        try {
          await this.deps.libby.placeHold({
            cardId: target.card.cardId,
            titleId: target.media.id,
            ...(this.cfg.hold.emailAddress ? { emailAddress: this.cfg.hold.emailAddress } : {}),
          });
        } catch (error) {
          if (!(await this.reconcileWrite("hold", target.card.cardId, target.media.id, error))) {
            if (this.cfg.failFast) throw error;
            emit({ ...rowFor(book, target.card, target.media), status: "error", message: (error as Error).message });
            continue;
          }
        }
        applyPlan(state, { kind: "hold", targets: [target] });
        let message: string | undefined;
        if (this.cfg.hold.suspendDays > 0) {
          try {
            await this.deps.libby.suspendHold({
              cardId: target.card.cardId,
              titleId: target.media.id,
              days: this.cfg.hold.suspendDays,
            });
            message = `suspended ${this.cfg.hold.suspendDays} days`;
          } catch (error) {
            // Report the completed hold before propagating any subsequent failure.
            emit({
              ...rowFor(book, target.card, target.media),
              status: "held",
              message: `hold placed; suspend failed: ${(error as Error).message}`,
            });
            if (
              error instanceof MutationUncertainError ||
              (error instanceof HttpError && error.isAuthError) ||
              this.cfg.failFast
            )
              throw error;
            emit({
              ...rowFor(book, target.card, target.media),
              status: "error",
              message: `suspend failed: ${(error as Error).message}`,
            });
            continue;
          }
        }
        emit({ ...rowFor(book, target.card, target.media), status: "held", ...(message ? { message } : {}) });
      }
      return;
    }
    for (const row of planToResults(book, plan, false)) emit(row);
  }

  /** Never replay a mutation whose response was lost; establish its outcome from the shelf. */
  private async reconcileWrite(
    kind: "loan" | "hold",
    cardId: string,
    titleId: string,
    error: unknown,
  ): Promise<boolean> {
    if (error instanceof HttpError && error.isAuthError) throw error;
    if (!(error instanceof MutationUncertainError) && !(error instanceof HttpError)) throw error;
    let shelf: SyncResponse;
    try {
      shelf = await this.deps.libby.sync();
    } catch (cause) {
      if (cause instanceof HttpError && cause.isAuthError) throw cause;
      throw new MutationUncertainError("Unable to verify the write outcome; stopping before further actions.", {
        cause,
      });
    }
    const items = kind === "loan" ? shelf.loans : shelf.holds;
    if (items?.some((item) => item.cardId === cardId && String(item.id) === titleId)) return true;
    if (error instanceof MutationUncertainError) throw error;
    return false;
  }

  private async search(libraryKey: string, book: BookRequest): Promise<ThunderMedia[]> {
    const mediaTypes = book.mediaTypes?.length ? book.mediaTypes : this.cfg.mediaTypes;
    const { thunder } = this.deps;
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
      const accepted = bestMatch(book, items, { ...this.cfg.matching, mediaTypes: this.cfg.mediaTypes });
      if (!accepted && book.title) {
        const query = [book.title, book.author].filter(Boolean).join(" ");
        items = await thunder.searchLibrary(libraryKey, { query, mediaTypes, perPage });
      }
    }
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
    throw new ConfigError(`No cards match the configured cards/libraries. Available: ${all.map(cardLabel).join(", ")}`);
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

function applyPlan(state: RunState, plan: Plan) {
  if (plan.kind === "borrow") {
    bump(state, plan.card.cardId, "loan");
    state.loanTitleIds.add(plan.media.id);
    state.borrowsThisRun++;
  } else if (plan.kind === "hold") {
    for (const target of plan.targets) {
      bump(state, target.card.cardId, "hold");
      state.holdTitleIds.add(target.media.id);
      state.holdsThisRun++;
    }
  }
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
