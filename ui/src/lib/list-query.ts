import type { ListQuery, TagGroups } from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";

export const emptyQuery = (): ListQuery => ({ includes: [[]], excludes: [[]] });
export const toggleTag = (selected: string[], id: string): string[] =>
  selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
export const unionTags = (groups: TagGroups): string[] => [...new Set(groups.flat())];

export function simpleQuery(query: ListQuery): ListQuery {
  return { includes: [unionTags(query.includes)], excludes: unionTags(query.excludes).map((id) => [id]) };
}
export function needsBoolean(query: ListQuery): boolean {
  return (
    query.includes.filter((group) => group.length > 0).length > 1 || query.excludes.some((group) => group.length > 1)
  );
}
export function formatTagGroups(groups: TagGroups, tags: LibbyTag[]): string {
  const names = new Map(tags.map((tag) => [tag.uuid, tag.name]));
  const parts = groups.map((group) => group.map((id) => names.get(id) ?? id).join(" AND ")).filter(Boolean);
  return parts.length
    ? parts.map((part) => (parts.length > 1 && part.includes(" AND ") ? `(${part})` : part)).join(" OR ")
    : "—";
}
