import type { ListLibraryAvailability } from "../../../src/libby-list-availability.ts";
import type { ListItem } from "../../../src/libby-lists.ts";

export type ListSort = "title" | "author";
export function sortListItems(items: ListItem[], sort: ListSort): ListItem[] {
  return [...items].sort((a, b) => {
    if (sort === "author") {
      if (!a.author && b.author) return 1;
      if (a.author && !b.author) return -1;
      const byAuthor = (a.author ?? "").localeCompare(b.author ?? "", undefined, { sensitivity: "base" });
      if (byAuthor) return byAuthor;
    }
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  });
}
export function listLibraryDetails({ status, media }: ListLibraryAvailability) {
  const checkedOut =
    typeof media?.ownedCopies === "number" &&
    typeof media.availableCopies === "number" &&
    media.availableCopies <= media.ownedCopies
      ? media.ownedCopies - media.availableCopies
      : undefined;
  const action =
    status === "ok" && media?.isAvailable === true
      ? "Borrow"
      : status === "ok" && media?.isHoldable === true
        ? "Place hold"
        : undefined;
  return { checkedOut, action };
}
export const libbyTitleUrl = (library: string, titleId: string) =>
  `https://libbyapp.com/library/${encodeURIComponent(library)}/everything/page-1/${encodeURIComponent(titleId)}`;
