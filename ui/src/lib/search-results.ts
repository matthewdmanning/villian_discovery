import type { Match } from "./api.ts";

export type SearchGroup = { key: string; title: string; author?: string; matches: Match[] };

/** Group only known title/author pairs; preserve the search's relevance order for books. */
export function groupSearchResults(
  matches: Match[],
  libraries: string[],
  mediaTypes: readonly string[],
): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  matches.forEach((match, index) => {
    const title = match.media.title.trim();
    const author = match.media.firstCreatorName?.trim();
    const key = title && author ? JSON.stringify([normalize(title), normalize(author)]) : `unknown-${index}`;
    const group = groups.get(key) ?? { key, title, ...(author && { author }), matches: [] };
    group.matches.push(match);
    groups.set(key, group);
  });
  const rank = (value: string | undefined, order: readonly string[]) => {
    const index = order.findIndex((item) => item.toLowerCase() === value?.toLowerCase());
    return index < 0 ? order.length : index;
  };
  const libraryOrder = [
    ...libraries,
    ...matches
      .map((match) => match.card.advantageKey)
      .filter((key) => !libraries.some((item) => item.toLowerCase() === key.toLowerCase())),
  ];
  const availability = (match: Match) =>
    match.media.isAvailable === true ? 0 : match.media.isAvailable === false ? 1 : 2;
  for (const group of groups.values()) {
    group.matches.sort(
      (a, b) =>
        availability(a) - availability(b) ||
        rank(a.card.advantageKey, libraryOrder) - rank(b.card.advantageKey, libraryOrder) ||
        rank(a.media.type?.id, mediaTypes) - rank(b.media.type?.id, mediaTypes),
    );
  }
  return [...groups.values()];
}

export type SearchFilters = {
  availability: "all" | "available";
  format: string;
  library: string;
  sort: "" | "relevance" | "title" | "author" | "available";
};

/** Filter options inside each book, then sort books without disturbing option priority. */
export function filterSearchGroups(groups: SearchGroup[], filters: SearchFilters): SearchGroup[] {
  const filtered = groups
    .map((group) => ({
      ...group,
      matches: group.matches.filter(
        (match) =>
          (filters.availability === "all" || match.media.isAvailable === true) &&
          (!filters.format || match.media.type?.id?.toLowerCase() === filters.format) &&
          (!filters.library || match.card.advantageKey.toLowerCase() === filters.library),
      ),
    }))
    .filter((group) => group.matches.length > 0);
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  if (filters.sort === "title") filtered.sort((a, b) => compare(a.title, b.title));
  if (filters.sort === "author")
    filtered.sort((a, b) =>
      !a.author ? (b.author ? 1 : 0) : !b.author ? -1 : compare(a.author, b.author) || compare(a.title, b.title),
    );
  if (filters.sort === "available")
    filtered.sort(
      (a, b) =>
        Number(b.matches.some((match) => match.media.isAvailable === true)) -
        Number(a.matches.some((match) => match.media.isAvailable === true)),
    );
  return filtered;
}
