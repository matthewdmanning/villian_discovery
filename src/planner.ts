import type { Config } from "./config.js";
import type { BookRequest } from "./input.js";
import type { Match } from "./matcher.js";
import type { LibbyCard, ThunderMedia } from "./types.js";

export interface Candidate {
  card: LibbyCard;
  match: Match;
}

export interface HoldTarget {
  card: LibbyCard;
  media: ThunderMedia;
}

export type Plan =
  | { kind: "borrow"; card: LibbyCard; media: ThunderMedia; days: number; luckyDay: boolean }
  | { kind: "hold"; targets: HoldTarget[] }
  | { kind: "skip"; reason: string; media?: ThunderMedia };

/** Mutable counters shared across one run. */
export interface RunState {
  /** cardId -> current counts (seeded from sync, updated as actions succeed). */
  counts: Map<string, { loan: number; hold: number }>;
  loanTitleIds: Set<string>;
  holdTitleIds: Set<string>;
  borrowsThisRun: number;
  holdsThisRun: number;
}

export type PlannerConfig = Pick<Config, "action" | "borrow" | "hold" | "skipExisting" | "respectCardLimits">;

/**
 * Decides what to do for one book. Pure: does not mutate state.
 * `candidates` must be in library priority order.
 */
export function planBook(book: BookRequest, candidates: Candidate[], state: RunState, cfg: PlannerConfig): Plan {
  if (!candidates.length) return { kind: "skip", reason: "not found in any library" };
  const action = book.action ?? cfg.action;
  const first = candidates[0]!.match.media;

  if (cfg.skipExisting) {
    const onLoan = candidates.find((c) => state.loanTitleIds.has(c.match.media.id));
    if (onLoan) return { kind: "skip", reason: "already on loan", media: onLoan.match.media };
    const onHold = candidates.find((c) => state.holdTitleIds.has(c.match.media.id));
    if (onHold) return { kind: "skip", reason: "already on hold", media: onHold.match.media };
  }

  const reasons: string[] = [];

  if (action === "auto" || action === "borrow") {
    const runFull = cfg.borrow.maxPerRun !== undefined && state.borrowsThisRun >= cfg.borrow.maxPerRun;
    const available = candidates.filter(({ match: { media } }) => isAvailable(media, cfg.borrow.luckyDay));
    const borrowable = available.filter(({ card }) => canUse(card, "loan", state, cfg));
    const pick = runFull ? undefined : borrowable[0];
    if (pick) {
      const media = pick.match.media;
      return {
        kind: "borrow",
        card: pick.card,
        media,
        days: lendingDays(pick.card, media.type?.id ?? "ebook", cfg.borrow.lendingPeriod),
        luckyDay: !media.isAvailable && (media.luckyDayAvailableCopies ?? 0) > 0,
      };
    }
    if (runFull && available.length) reasons.push("borrow limit for this run reached");
    else if (available.length) reasons.push("available, but every card is at its loan limit");
    else reasons.push("no copies available");
    if (action === "borrow") return { kind: "skip", reason: reasons.join("; "), media: first };
  }

  if (cfg.hold.maxPerRun !== undefined && state.holdsThisRun >= cfg.hold.maxPerRun) {
    reasons.push("hold limit for this run reached");
    return { kind: "skip", reason: reasons.join("; "), media: first };
  }

  const owned = candidates.filter(({ match: { media } }) => media.isHoldable !== false && isOwned(media));
  if (!owned.length) {
    reasons.push("no library owns a holdable copy");
    return { kind: "skip", reason: reasons.join("; "), media: first };
  }
  const withinLimits = owned.filter(({ card }) => canUse(card, "hold", state, cfg));
  if (!withinLimits.length) {
    reasons.push("every card is at its hold limit");
    return { kind: "skip", reason: reasons.join("; "), media: first };
  }
  const acceptable = withinLimits.filter(({ match: { media } }) => {
    const { maxEstimatedWaitDays: maxWait, maxHoldsCount: maxHolds } = cfg.hold;
    if (maxWait !== undefined && media.estimatedWaitDays !== undefined && media.estimatedWaitDays > maxWait) return false;
    if (maxHolds !== undefined && media.holdsCount !== undefined && media.holdsCount > maxHolds) return false;
    return true;
  });
  if (!acceptable.length) {
    const waits = withinLimits.map((c) => c.match.media.estimatedWaitDays).filter((w) => w !== undefined);
    reasons.push(`wait too long${waits.length ? ` (shortest ~${Math.min(...waits)} days)` : ""}`);
    return { kind: "skip", reason: reasons.join("; "), media: first };
  }

  let chosen: Candidate[];
  switch (cfg.hold.placement) {
    case "first":
      chosen = [acceptable[0]!];
      break;
    case "all": {
      const room = cfg.hold.maxPerRun === undefined ? Infinity : cfg.hold.maxPerRun - state.holdsThisRun;
      chosen = onePerLibrary(acceptable).slice(0, room);
      break;
    }
    case "best":
      chosen = [
        acceptable.reduce((a, b) => (waitOf(b.match.media) < waitOf(a.match.media) ? b : a)),
      ];
      break;
  }
  return { kind: "hold", targets: chosen.map((c) => ({ card: c.card, media: c.match.media })) };
}

export function isAvailable(media: ThunderMedia, allowLuckyDay: boolean): boolean {
  return media.isAvailable === true || (allowLuckyDay && (media.luckyDayAvailableCopies ?? 0) > 0);
}

function isOwned(media: ThunderMedia): boolean {
  return media.isOwned === true || (media.ownedCopies ?? 0) > 0 || media.isPreReleaseTitle === true;
}

function waitOf(media: ThunderMedia): number {
  return media.estimatedWaitDays ?? Number.POSITIVE_INFINITY;
}

function onePerLibrary(cands: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return cands.filter((c) => !seen.has(c.card.advantageKey) && seen.add(c.card.advantageKey));
}

export function canUse(card: LibbyCard, kind: "loan" | "hold", state: RunState, cfg: Pick<Config, "respectCardLimits">): boolean {
  if (!cfg.respectCardLimits) return true;
  const limit = card.limits?.[kind];
  if (limit === undefined) return true;
  const used = state.counts.get(card.cardId)?.[kind] ?? card.counts?.[kind] ?? 0;
  return used < limit;
}

const FALLBACK_LENDING_DAYS = 21;

/** Resolves a loan length in days from the card's lending periods. */
export function lendingDays(card: LibbyCard, mediaType: string, pref: Config["borrow"]["lendingPeriod"]): number {
  const key = mediaType === "ebook" ? "book" : mediaType;
  const lp = card.lendingPeriods?.[key];
  const options = (lp?.options ?? []).map((o) => o[0]).filter((n) => n > 0).sort((a, b) => a - b);
  if (pref === "preference") return lp?.preference?.[0] || options.at(-1) || FALLBACK_LENDING_DAYS;
  if (pref === "max") return options.at(-1) ?? FALLBACK_LENDING_DAYS;
  if (!options.length) return pref;
  // Fixed number: closest offered option not above it, else the shortest option.
  return [...options].reverse().find((o) => o <= pref) ?? options[0]!;
}
