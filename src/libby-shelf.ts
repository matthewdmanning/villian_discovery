import type { LibbyClient } from "./libby-client.js";
import type { ShelfItem } from "./types.js";

export interface ShelfEntry {
  id: string;
  cardId: string;
  title: string;
  author?: string;
  cardName?: string;
  mediaType?: string;
  holdListPosition?: number;
}

export type ShelfTab = { status: "available"; items: ShelfEntry[] } | { status: "unavailable"; reason: string };

export interface ShelfData {
  checkedOut: ShelfTab;
  holds: ShelfTab;
  returned: ShelfTab;
}

const returnedUnavailable = "Returned history is not connected yet.";

function entries(items: ShelfItem[], cards: ReadonlyMap<string, string>): ShelfEntry[] {
  return items.flatMap((item) => {
    if (!item.title) return [];
    const author = typeof item.firstCreatorName === "string" ? item.firstCreatorName : undefined;
    const cardName = cards.get(item.cardId);
    const mediaType = typeof item.type?.id === "string" ? item.type.id : undefined;
    const position = typeof item.holdListPosition === "number" ? item.holdListPosition : undefined;
    return [
      {
        id: item.id,
        cardId: item.cardId,
        title: item.title,
        ...(author ? { author } : {}),
        ...(cardName ? { cardName } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(position === undefined ? {} : { holdListPosition: position }),
      },
    ];
  });
}

function shelfTab(value: unknown, label: string, cards: ReadonlyMap<string, string>): ShelfTab {
  return Array.isArray(value)
    ? { status: "available", items: entries(value as ShelfItem[], cards) }
    : { status: "unavailable", reason: `Libby did not provide ${label} data.` };
}

/** Read Libby's verified current loans and holds. Returned titles stay unavailable until Libby exposes a verified source. */
export async function listShelf(client: LibbyClient): Promise<ShelfData> {
  const state = await client.sync();
  const cards = new Map((state.cards ?? []).map((card) => [card.cardId, card.cardName ?? card.cardId]));
  return {
    checkedOut: shelfTab(state.loans, "checked-out", cards),
    holds: shelfTab(state.holds, "holds", cards),
    returned: { status: "unavailable", reason: returnedUnavailable },
  };
}

/** Use this response for demo mode; it intentionally contains no fabricated shelf rows. */
export const unavailableShelf = (reason: string): ShelfData => ({
  checkedOut: { status: "unavailable", reason },
  holds: { status: "unavailable", reason },
  returned: { status: "unavailable", reason: returnedUnavailable },
});
