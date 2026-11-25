import { mediaAuthors, normalizeName, normalizeTitle } from "../../../src/matcher.js";
import type { Match } from "./api.ts";

export type SearchGroup = { key: string; title: string; author?: string; matches: Match[] };

/** Group only known title/author pairs; preserve the search's relevance order for books. */
export function groupSearchResults(
  matches: Match[],
  libraries: string[],
  mediaTypes: readonly string[],
): SearchGroup[] {
  const metadata = matches.map((match) => {
    const title = match.media.title.trim();
    const titleKey = title ? normalizeTitle(title, false) : undefined;
    const authors = mediaAuthors(match.media);
    const authorKey = authors.length
      ? [...new Set(authors.map((author) => normalizeName(author, true)))].sort().join("|")
      : undefined;
    return {
      title,
      titleKey,
      authors,
      authorKey,
      workKey: titleKey && authorKey ? `work:${titleKey}|authors:${authorKey}` : undefined,
      id: match.media.id.trim(),
    };
  });
  type Identity = (typeof metadata)[number];
  const identifiedById = new Map<string, Identity | null>();
  metadata.forEach((identity) => {
    if (!identity.id || !identity.workKey) return;
    const previous = identifiedById.get(identity.id);
    identifiedById.set(identity.id, previous === undefined || previous?.workKey === identity.workKey ? identity : null);
  });
  const groups = new Map<string, SearchGroup>();
  matches.forEach((match, index) => {
    const current = metadata[index]!;
    const identified = current.workKey
      ? current
      : current.id
        ? (identifiedById.get(current.id) ?? undefined)
        : undefined;
    const compatible =
      identified &&
      (!current.titleKey || !identified.titleKey || current.titleKey === identified.titleKey) &&
      (!current.authorKey || !identified.authorKey || current.authorKey === identified.authorKey);
    const identity = compatible ? identified : undefined;
    const key = identity?.workKey ?? (current.id ? `catalog:${current.id}` : `unknown-${index}`);
    const displayTitle = identity?.title || current.title;
    const displayAuthor = identity?.authors.length ? identity.authors.join(", ") : current.authors.join(", ");
    const group = groups.get(key) ?? {
      key,
      title: displayTitle,
      ...(displayAuthor && { author: displayAuthor }),
      matches: [],
    };
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
