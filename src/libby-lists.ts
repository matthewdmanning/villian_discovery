import { type LibbyTag, parseTagsResponse } from "./libby-tags-cache.js";

export interface ListItem {
  id: string;
  title: string;
  author?: string;
  tags: string[];
}
export interface ListsData {
  tags: LibbyTag[];
  items: ListItem[];
}

/** Read all tagged titles. An empty query ranges over titles in at least one tag. */
export async function readLists(client: {
  tags(): Promise<unknown>;
  taggings(tag: LibbyTag): Promise<unknown>;
}): Promise<ListsData> {
  const tags = parseTagsResponse(await client.tags());
  const responses = await mapLimit(tags, TAG_CONCURRENCY, (tag) => client.taggings(tag));
  const items = new Map<string, ListItem>();
  for (const [index, response] of responses.entries()) {
    const tag = tags[index]!;
    if (!isRecord(response) || !isRecord(response.tag) || !Array.isArray(response.tag.taggings)) {
      throw new Error(`Could not read titles for ${tag.name}`);
    }
    for (const tagging of response.tag.taggings) {
      if (!isRecord(tagging) || (typeof tagging.titleId !== "string" && typeof tagging.titleId !== "number")) {
        throw new Error(`Could not read titles for ${tag.name}`);
      }
      const id = String(tagging.titleId);
      let item = items.get(id);
      if (!item) {
        item = {
          id,
          title: typeof tagging.sortTitle === "string" && tagging.sortTitle.trim() ? tagging.sortTitle : `Title ${id}`,
          tags: [],
        };
        if (typeof tagging.sortAuthor === "string" && tagging.sortAuthor.trim()) item.author = tagging.sortAuthor;
        items.set(id, item);
      }
      if (!item.tags.includes(tag.uuid)) item.tags.push(tag.uuid);
    }
  }
  return { tags, items: [...items.values()] };
}

/** Tags read at once, so an account with many tags stays under Libby's rate limits. */
export const TAG_CONCURRENCY = 4;

/** Map in input order with at most `limit` calls in flight; the first failure rejects and starts no more calls. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filterListItems(items: ListItem[], includes: string[], excludes: string[]): ListItem[] {
  return items.filter(
    (item) => includes.every((tag) => item.tags.includes(tag)) && excludes.every((tag) => !item.tags.includes(tag)),
  );
}

/** Each group requires all its tags; groups are alternatives. Empty groups do not match. */
export type TagGroups = string[][];

export function matchesTagGroups(tags: string[], groups: TagGroups): boolean {
  return groups.some((group) => group.length > 0 && group.every((tag) => tags.includes(tag)));
}

export function filterListGroups(items: ListItem[], includes: TagGroups, excludes: TagGroups): ListItem[] {
  const hasIncludes = includes.some((group) => group.length > 0);
  return items.filter(
    (item) => (!hasIncludes || matchesTagGroups(item.tags, includes)) && !matchesTagGroups(item.tags, excludes),
  );
}

export interface ListQuery {
  includes: TagGroups;
  excludes: TagGroups;
}

/** Ignore ordering, duplicate tags and redundant OR groups when comparing queries. */
export function listQueryKey(query: ListQuery): string {
  function normalize(groups: TagGroups): string[][] {
    const distinct = new Map<string, string[]>();
    for (const group of groups) {
      const tags = [...new Set(group)].sort();
      if (tags.length) distinct.set(JSON.stringify(tags), tags);
    }
    const candidates = [...distinct.values()];
    return candidates
      .filter(
        (group) =>
          !candidates.some((other) => other.length < group.length && other.every((tag) => group.includes(tag))),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return JSON.stringify([normalize(query.includes), normalize(query.excludes)]);
}

export function filterListQueries(items: ListItem[], queries: ListQuery[]): ListItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    const match = queries.some((query) => filterListGroups([item], query.includes, query.excludes).length > 0);
    if (match) seen.add(item.id);
    return match;
  });
}

/** Include a populated draft alongside saved searches; an empty draft is a new search placeholder. */
export function activeListQueries(saved: ListQuery[], draft: ListQuery): ListQuery[] {
  return saved.length && ![...draft.includes, ...draft.excludes].some((group) => group.length > 0)
    ? saved
    : [...saved, draft];
}
