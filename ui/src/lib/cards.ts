import type { LibbyCard } from "./api.ts";

export function cardSelected(selection: string[], card: LibbyCard): boolean {
  const wanted = selection.map((value) => value.toLowerCase());
  return (
    !wanted.length || wanted.includes(card.cardId.toLowerCase()) || wanted.includes((card.cardName ?? "").toLowerCase())
  );
}

/** Empty means all cards in the library config, so at least one must stay selected. */
export function toggleCard(cards: LibbyCard[], selection: string[], card: LibbyCard, on: boolean): string[] {
  const next = cards
    .filter((candidate) => (candidate === card ? on : cardSelected(selection, candidate)))
    .map((c) => c.cardId);
  return next.length ? next : selection;
}

export function libraryOrder(cards: LibbyCard[], priority: string[]): string[] {
  const keys = [...new Set(cards.map((card) => card.advantageKey))];
  const ordered = priority.flatMap((key) => keys.filter((candidate) => candidate.toLowerCase() === key.toLowerCase()));
  return [...new Set([...ordered, ...keys])];
}

export function cardUsage(card: LibbyCard, kind: "loan" | "hold") {
  const used = card.counts?.[kind];
  const limit = card.limits?.[kind];
  return { used, limit, isFull: used !== undefined && limit !== undefined && used >= limit };
}
