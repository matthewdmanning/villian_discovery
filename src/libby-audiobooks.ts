import type { LibbyClient } from "./libby-client.js";
import { mediaNarrators } from "./matcher.js";
import type { ThunderClient } from "./thunder-client.js";
import type { LibbyCard, ShelfItem } from "./types.js";

export type CatalogReader = Pick<ThunderClient, "getLibraryMedia">;

export type AudiobookStatus = "not started" | "reading" | "finished" | "progress unavailable" | "card missing";

export interface AudiobookRow {
  titleId: string;
  title: string;
  narrators?: string[];
  /** Percent of the book read, 0-100; undefined when Libby gave no position. */
  progress?: number;
  status: AudiobookStatus;
  /** Libby address that opens the loan; undefined when the loan's card is not in the account. */
  url?: string;
}

/** Use this function to build the libbyapp.com address that opens a checked-out title. */
export const loanUrl = (cardId: string, titleId: string) =>
  `https://libbyapp.com/open/loan/${encodeURIComponent(cardId)}/${encodeURIComponent(titleId)}`;

const statusOf = (progress: number | undefined): AudiobookStatus =>
  progress === undefined
    ? "progress unavailable"
    : progress >= 100
      ? "finished"
      : progress > 0
        ? "reading"
        : "not started";

// ponytail: bounded process cache; public metadata refreshes after eviction and is never persisted.
const narratorCaches = new WeakMap<CatalogReader, Map<string, Promise<string[]>>>();
const NARRATOR_CACHE_LIMIT = 128;

/** Use this function to resolve explicit narrator credits for a shelf item, with public catalog fallback for audiobooks. Inputs: `item` — the Libby loan or hold; `card` — its Libby card and public library key; `catalog` — optional public catalog reader. Dependencies: `mediaNarrators`, `CatalogReader.getLibraryMedia`. */
export async function narratorsForItem(
  item: Pick<ShelfItem, "id" | "type" | "creators">,
  card?: Pick<LibbyCard, "advantageKey">,
  catalog?: CatalogReader,
): Promise<string[]> {
  if (item.type?.id !== "audiobook") return [];
  const direct = mediaNarrators(item);
  const library = card?.advantageKey;
  if (direct.length || !catalog || !library) return direct;
  const key = JSON.stringify([library, item.id]);
  let cache = narratorCaches.get(catalog);
  if (!cache) {
    cache = new Map();
    narratorCaches.set(catalog, cache);
  }
  let pending = cache.get(key);
  if (!pending) {
    if (cache.size >= NARRATOR_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    pending = Promise.resolve()
      .then(() => catalog.getLibraryMedia(library, item.id))
      .then(mediaNarrators)
      .catch(() => []);
    cache.set(key, pending);
  }
  const narrators = await pending;
  if (!narrators.length && cache.get(key) === pending) cache.delete(key);
  return narrators;
}

/** Use this function to list the account's audiobook loans; a failed `chip/sync` throws, so it never reads as no books. A failed progress read keeps unknown progress, never 0. */
export async function listAudiobookLoans(client: LibbyClient, catalog?: CatalogReader): Promise<AudiobookRow[]> {
  const { cards = [], loans = [] } = await client.sync();
  const cardsById = new Map(cards.map((card) => [card.cardId, card]));
  const audiobooks = loans.filter((loan) => loan.type?.id === "audiobook" && loan.title);
  return Promise.all(
    audiobooks.map(async (loan): Promise<AudiobookRow> => {
      const base = { titleId: loan.id, title: loan.title as string };
      const card = cardsById.get(loan.cardId);
      const progressPromise = card
        ? client.loanProgress({ cardId: loan.cardId, titleId: loan.id, mediaType: "audiobook" }).catch(() => undefined)
        : Promise.resolve(undefined);
      const [narrators, progress] = await Promise.all([narratorsForItem(loan, card, catalog), progressPromise]);
      if (!card) {
        return { ...base, ...(narrators.length ? { narrators } : {}), status: "card missing" };
      }
      return {
        ...base,
        ...(narrators.length ? { narrators } : {}),
        ...(progress === undefined ? {} : { progress }),
        status: statusOf(progress),
        url: loanUrl(loan.cardId, loan.id),
      };
    }),
  );
}
