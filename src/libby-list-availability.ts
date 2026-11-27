import { HttpError } from "./errors.js";
import type { LibbyCard, ThunderMedia } from "./types.js";

export interface ListLibraryAvailability {
  card: LibbyCard;
  status: "ok" | "not-offered" | "error";
  media?: ThunderMedia;
}

/** Read each card's library separately so one failed catalog does not hide the others. */
export async function listLibraryAvailability(
  titleId: string,
  client: { sync(): Promise<{ cards?: LibbyCard[] }> },
  catalog: { getLibraryMedia(library: string, id: string): Promise<ThunderMedia> },
): Promise<ListLibraryAvailability[]> {
  if (typeof titleId !== "string" || !titleId.trim() || titleId.length > 200) throw new Error("Invalid title ID");
  const { cards = [] } = await client.sync();
  return Promise.all(
    cards.map(async (card): Promise<ListLibraryAvailability> => {
      try {
        const media = await catalog.getLibraryMedia(card.advantageKey, titleId);
        return { card, status: media.isOwned === false ? "not-offered" : "ok", media };
      } catch (error) {
        return { card, status: error instanceof HttpError && error.status === 404 ? "not-offered" : "error" };
      }
    }),
  );
}
