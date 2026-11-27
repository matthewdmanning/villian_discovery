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
  const responses = await Promise.all(tags.map((tag) => client.taggings(tag)));
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
