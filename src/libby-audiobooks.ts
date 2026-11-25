import type { LibbyClient } from "./libby-client.js";

export type AudiobookStatus = "not started" | "reading" | "finished" | "progress unavailable" | "card missing";

export interface AudiobookRow {
  titleId: string;
  title: string;
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

/** Use this function to list the account's audiobook loans; a failed `chip/sync` throws, so it never reads as no books. A failed progress read keeps unknown progress, never 0. */
export async function listAudiobookLoans(client: LibbyClient): Promise<AudiobookRow[]> {
  const { cards = [], loans = [] } = await client.sync();
  const knownCards = new Set(cards.map((card) => card.cardId));
  const audiobooks = loans.filter((loan) => loan.type?.id === "audiobook" && loan.title);
  return Promise.all(
    audiobooks.map(async (loan): Promise<AudiobookRow> => {
      const base = { titleId: loan.id, title: loan.title as string };
      if (!knownCards.has(loan.cardId)) return { ...base, status: "card missing" };
      const progress = await client
        .loanProgress({ cardId: loan.cardId, titleId: loan.id, mediaType: "audiobook" })
        .catch(() => undefined);
      return {
        ...base,
        ...(progress === undefined ? {} : { progress }),
        status: statusOf(progress),
        url: loanUrl(loan.cardId, loan.id),
      };
    }),
  );
}
