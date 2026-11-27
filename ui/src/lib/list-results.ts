import type { ListLibraryAvailability } from "../../../src/libby-list-availability.ts";
import type { ListItem } from "../../../src/libby-lists.ts";

export type ListSort = "title" | "author";
/** Title for sorting: a leading "The", "A" or "An" does not count. */
const sortKey = (title: string) => title.trim().replace(/^(?:the|an?)\s+/i, "");
export function sortListItems(items: ListItem[], sort: ListSort): ListItem[] {
  return [...items].sort((a, b) => {
    if (sort === "author") {
      if (!a.author && b.author) return 1;
      if (a.author && !b.author) return -1;
      const byAuthor = (a.author ?? "").localeCompare(b.author ?? "", undefined, { sensitivity: "base" });
      if (byAuthor) return byAuthor;
    }
    return (
      sortKey(a.title).localeCompare(sortKey(b.title), undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id)
    );
  });
}
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
/**
 * Counts for the Available cell, always two integers. A missing total counts as 0. A missing available count
 * means every copy is out when the title is not available, and none is out otherwise.
 */
export function listLibraryDetails({ status, media }: ListLibraryAvailability) {
  const total = count(media?.ownedCopies) ?? 0;
  const available = count(media?.availableCopies) ?? (media?.isAvailable === false ? 0 : total);
  const checkedOut = Math.max(0, total - Math.min(available, total));
  const action =
    status === "ok" && media?.isAvailable === true
      ? "Borrow"
      : status === "ok" && media?.isHoldable === true
        ? "Place hold"
        : undefined;
  return { checkedOut, total, action };
}
export const libbyTitleUrl = (library: string, titleId: string) =>
  `https://libbyapp.com/library/${encodeURIComponent(library)}/everything/page-1/${encodeURIComponent(titleId)}`;
