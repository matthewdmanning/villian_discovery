import type { BookRequest } from "./input.js";
import type { ThunderMedia } from "./types.js";

export interface MatchOptions {
  minTitleScore: number;
  minAuthorScore: number;
  ignoreSubtitle: boolean;
  allowPreRelease: boolean;
  mediaTypes: readonly string[];
}

export interface Match {
  media: ThunderMedia;
  titleScore: number;
  authorScore: number | undefined;
  isbnMatch: boolean;
}

/** Picks the best matching title, or undefined if nothing clears the thresholds. */
export function bestMatch(book: BookRequest, items: ThunderMedia[], o: MatchOptions): Match | undefined {
  const types = book.mediaTypes?.length ? book.mediaTypes : o.mediaTypes;
  let best: (Match & { rank: number }) | undefined;
  for (const media of items) {
    const type = media.type?.id;
    if (type && !types.includes(type)) continue;
    if (media.isPreReleaseTitle && !o.allowPreRelease) continue;
    const m = scoreMatch(book, media, o);
    if (!m) continue;
    // Rank: ISBN match first, then title+author score, then preferred media type.
    const typeBonus = type ? (types.length - types.indexOf(type)) / (types.length * 100) : 0;
    const rank = (m.isbnMatch ? 10 : 0) + m.titleScore + (m.authorScore ?? 0) + typeBonus;
    if (!best || rank > best.rank) best = { ...m, rank };
  }
  if (!best) return undefined;
  const { rank: _r, ...match } = best;
  return match;
}

export function scoreMatch(book: BookRequest, media: ThunderMedia, o: MatchOptions): Match | undefined {
  if (book.titleId) {
    return media.id === book.titleId ? { media, titleScore: 1, authorScore: undefined, isbnMatch: false } : undefined;
  }
  const isbnMatch = book.isbn ? mediaHasIsbn(media, book.isbn) : false;
  if (book.isbn && !book.title) {
    return isbnMatch ? { media, titleScore: 1, authorScore: undefined, isbnMatch } : undefined;
  }
  const titleScore = book.title ? titleSimilarity(book.title, media, o.ignoreSubtitle) : 1;
  const authorScore = book.author ? authorSimilarity(book.author, media) : undefined;
  if (isbnMatch) return { media, titleScore, authorScore, isbnMatch };
  if (titleScore < o.minTitleScore) return undefined;
  if (authorScore !== undefined && authorScore < o.minAuthorScore) return undefined;
  return { media, titleScore, authorScore, isbnMatch };
}

export function titleSimilarity(wanted: string, media: ThunderMedia, ignoreSubtitle: boolean): number {
  const w = normalizeTitle(wanted, ignoreSubtitle);
  const candidates = [media.title];
  if (media.subtitle) candidates.push(`${media.title}: ${media.subtitle}`);
  return Math.max(...candidates.map((c) => dice(w, normalizeTitle(c, ignoreSubtitle))));
}

export function authorSimilarity(wanted: string, media: ThunderMedia): number {
  const names = [media.firstCreatorName, ...(media.creators ?? []).map((c) => c.name)].filter((n): n is string => !!n);
  if (!names.length) return 0;
  const w = normalizeName(wanted);
  return Math.max(...names.map((n) => dice(w, normalizeName(n))));
}

export function mediaHasIsbn(media: ThunderMedia, isbn: string): boolean {
  const wanted = new Set([isbn, toIsbn13(isbn)].filter(Boolean));
  for (const f of media.formats ?? []) {
    for (const id of f.identifiers ?? []) {
      if (!/isbn/i.test(id.type)) continue;
      const v = id.value.replace(/[\s-]/g, "").toUpperCase();
      if (wanted.has(v) || wanted.has(toIsbn13(v) ?? "")) return true;
    }
  }
  return false;
}

export function toIsbn13(isbn: string): string | undefined {
  if (/^\d{13}$/.test(isbn)) return isbn;
  if (!/^\d{9}[\dX]$/.test(isbn)) return undefined;
  const core = `978${isbn.slice(0, 9)}`;
  const sum = [...core].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return core + ((10 - (sum % 10)) % 10);
}

const ARTICLES = /^(the|a|an)\s+/;

export function normalizeTitle(s: string, ignoreSubtitle: boolean): string {
  let t = fold(s);
  if (ignoreSubtitle) t = t.split(/[:(]/)[0] ?? t;
  t = t
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.replace(ARTICLES, "");
}

/** Order-insensitive name key, so "Weir, Andy" equals "Andy Weir". */
export function normalizeName(s: string): string {
  return fold(s)
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1) // drop initials
    .sort()
    .join(" ");
}

function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ");
}

/** Sørensen–Dice coefficient over character bigrams. 1 = identical. */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}
