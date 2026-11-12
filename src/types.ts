/**
 * Shapes of the unofficial Libby (Sentry) and OverDrive (Thunder) APIs.
 * Only fields this tool reads are typed; everything else passes through.
 * Field names verified against ping/libby-calibre-plugin and mknabe/book-club.
 */

export type MediaType = "ebook" | "audiobook" | "magazine";

export interface LibbyCard {
  cardId: string;
  cardName?: string;
  /** Library key used by Thunder, e.g. "lapl". */
  advantageKey: string;
  library?: { websiteId?: number; name?: string };
  limits?: { loan?: number; hold?: number };
  counts?: { loan?: number; hold?: number };
  /** Keyed by "book" | "audiobook" | "magazine". */
  lendingPeriods?: Record<string, { options?: [number, string][]; preference?: [number, string] }>;
  [k: string]: unknown;
}

export interface ShelfItem {
  id: string;
  cardId: string;
  title?: string;
  type?: { id: string };
  isAvailable?: boolean;
  holdListPosition?: number;
  [k: string]: unknown;
}

export interface SyncResponse {
  result?: string;
  cards?: LibbyCard[];
  loans?: ShelfItem[];
  holds?: ShelfItem[];
  [k: string]: unknown;
}

export interface ChipResponse {
  identity?: string;
  [k: string]: unknown;
}

export interface MediaFormat {
  id: string;
  identifiers?: { type: string; value: string }[];
}

/** A title as returned by Thunder `libraries/{key}/media`. Availability fields are library-scoped. */
export interface ThunderMedia {
  id: string;
  title: string;
  subtitle?: string;
  firstCreatorName?: string;
  creators?: { name: string; role?: string }[];
  type?: { id: string; name?: string };
  formats?: MediaFormat[];
  isAvailable?: boolean;
  isHoldable?: boolean;
  isOwned?: boolean;
  ownedCopies?: number;
  availableCopies?: number;
  holdsCount?: number;
  estimatedWaitDays?: number;
  luckyDayAvailableCopies?: number;
  isPreReleaseTitle?: boolean;
  [k: string]: unknown;
}

export interface ThunderSearchResponse {
  items?: ThunderMedia[];
  totalItems?: number;
  [k: string]: unknown;
}
