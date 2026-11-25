import { type CatalogReader, narratorsForItem } from "./libby-audiobooks.js";
import type { LibbyClient } from "./libby-client.js";
import { mediaAuthors } from "./matcher.js";
import type { ShelfItem } from "./types.js";

export interface ShelfEntry {
  id: string;
  cardId: string;
  title: string;
  author?: string;
  narrators?: string[];
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

async function entries(
  items: ShelfItem[],
  cards: ReadonlyMap<string, { name: string; advantageKey: string }>,
  catalog?: CatalogReader,
): Promise<ShelfEntry[]> {
  return (
    await Promise.all(
      items.map(async (item) => {
        if (!item.title) return [];
        const author = mediaAuthors({
          ...(Array.isArray(item.creators) ? { creators: item.creators } : {}),
          ...(typeof item.firstCreatorName === "string" ? { firstCreatorName: item.firstCreatorName } : {}),
        })[0];
        const card = cards.get(item.cardId);
        const narrators = await narratorsForItem(item, card, catalog);
        const mediaType = typeof item.type?.id === "string" ? item.type.id : undefined;
        const position = typeof item.holdListPosition === "number" ? item.holdListPosition : undefined;
        return [
          {
            id: item.id,
            cardId: item.cardId,
            title: item.title,
            ...(author ? { author } : {}),
            ...(narrators.length ? { narrators } : {}),
            ...(card?.name ? { cardName: card.name } : {}),
            ...(mediaType ? { mediaType } : {}),
            ...(position === undefined ? {} : { holdListPosition: position }),
          },
        ];
      }),
    )
  ).flat();
}

async function shelfTab(
  value: unknown,
  label: string,
  cards: ReadonlyMap<string, { name: string; advantageKey: string }>,
  catalog?: CatalogReader,
): Promise<ShelfTab> {
  return Array.isArray(value)
    ? { status: "available", items: await entries(value as ShelfItem[], cards, catalog) }
    : { status: "unavailable", reason: `Libby did not provide ${label} data.` };
}

/** Read Libby's verified current loans and holds. Returned titles stay unavailable until Libby exposes a verified source. */
export async function listShelf(client: LibbyClient, catalog?: CatalogReader): Promise<ShelfData> {
  const state = await client.sync();
  const cards = new Map(
    (state.cards ?? []).map((card) => [
      card.cardId,
      { name: card.cardName ?? card.cardId, advantageKey: card.advantageKey },
    ]),
  );
  const [checkedOut, holds] = await Promise.all([
    shelfTab(state.loans, "checked-out", cards, catalog),
    shelfTab(state.holds, "holds", cards, catalog),
  ]);
  return {
    checkedOut,
    holds,
    returned: { status: "unavailable", reason: returnedUnavailable },
  };
}

/** Use this response for demo mode; it intentionally contains no fabricated shelf rows. */
export const unavailableShelf = (reason: string): ShelfData => ({
  checkedOut: { status: "unavailable", reason },
  holds: { status: "unavailable", reason },
  returned: { status: "unavailable", reason: returnedUnavailable },
});
