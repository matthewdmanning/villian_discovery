import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { InputFormat } from "../../../src/input.ts";
import type { SyncField } from "../../../src/sync.ts";
import type { SyncApplyReport, SyncApprovals, SyncPlan } from "../../../src/sync-plan.ts";
import { type BookRequest, type BookResult, demoApi, type LibbyCard, type LibraryApi } from "./api.ts";
import { type Config, type ConfigInput, resolve, setPath } from "./config.ts";
import { options, type ScreenId, screens } from "./spec.ts";
import { useResource } from "./use-resource.ts";

export type BookDraftEdit = {
  mediaTypes?: BookRequest["mediaTypes"] | undefined;
  action?: BookRequest["action"] | undefined;
  libraries?: BookRequest["libraries"] | undefined;
};
export type BookDraft = {
  text: string;
  fileName?: string | undefined;
  format: "auto" | InputFormat;
  edits: Record<number, BookDraftEdit>;
};

interface Store {
  api: LibraryApi;
  screen: ScreenId;
  go(id: ScreenId): void;
  overrides: ConfigInput;
  config: Config;
  configError?: string;
  set(path: string, value: unknown): void;
  cards: LibbyCard[];
  cardsLoading: boolean;
  cardsError?: string;
  refreshCards(): void;
  /** Reload cards immediately after an observed account change. */
  forceRefreshCards(): void;
  books: BookRequest[];
  setBooks(b: BookRequest[]): void;
  draft: BookDraft;
  setDraft(patch: Partial<BookDraft>): void;
  results: { rows: BookResult[]; dryRun: boolean } | undefined;
  setResults(r: { rows: BookResult[]; dryRun: boolean } | undefined): void;
  syncResult:
    | { rows: SyncField[]; plan: SyncPlan; report?: SyncApplyReport; comparedAt: string; review: SyncApprovals }
    | undefined;
  setSyncResult(result: Store["syncResult"]): void;
  syncBusy: boolean;
  setSyncBusy(value: boolean): void;
  syncError: string | undefined;
  setSyncError(value: string | undefined): void;
  /** Unposted Fable reviews by book page URL; they outlive the Shelf, which unmounts during Sync and Apply. */
  reviewDrafts: Readonly<Record<string, string>>;
  setReviewDraft(pageUrl: string, text: string): void;
}

const Ctx = createContext<Store | null>(null);
const KEY = "libby-shelf.config";
const NO_CARDS: LibbyCard[] = [];

/** Saved overrides. The UI starts in dry run (wireframe default) until the user turns it off. */
function load(): ConfigInput {
  try {
    return { dryRun: true, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as ConfigInput) };
  } catch {
    return { dryRun: true };
  }
}

export function StoreProvider({ children, api = demoApi }: { children: ReactNode; api?: LibraryApi }) {
  const first = screens.some((s) => s.id === options.defaultScreen)
    ? options.defaultScreen
    : (screens[0]?.id ?? "shelf");
  const [screen, go] = useState<ScreenId>(first);
  const [resolved, setResolved] = useState(() => {
    const overrides = load();
    return { overrides, ...resolve(overrides) };
  });
  const tokenFile = resolved.config.auth.tokenFile;
  const cardsResource = useResource(useCallback(() => api.cards(tokenFile), [api, tokenFile]));
  const cards = cardsResource.data ?? NO_CARDS;
  const { loading: cardsLoading, error: cardsError, reload: refreshCards, forceReload: reloadCards } = cardsResource;
  const [books, setBooks] = useState<BookRequest[]>([]);
  const [draft, setDraftState] = useState<BookDraft>({ text: "", format: "auto", edits: {} });
  const [results, setResults] = useState<Store["results"]>();
  const [syncResult, setSyncResult] = useState<Store["syncResult"]>();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const setReviewDraft = useCallback(
    (pageUrl: string, text: string) => setReviewDrafts((drafts) => ({ ...drafts, [pageUrl]: text })),
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(resolved.overrides));
    } catch {
      /* storage blocked: settings last for this tab only */
    }
  }, [resolved.overrides]);

  const set = useCallback(
    (path: string, value: unknown) =>
      setResolved((state) => {
        const overrides = setPath(state.overrides, path, value);
        return { overrides, ...resolve(overrides, state.config) };
      }),
    [],
  );
  const setDraft = useCallback(
    (patch: Partial<BookDraft>) =>
      setDraftState((d) => ({
        ...d,
        ...patch,
        ...(Object.hasOwn(patch, "text") || Object.hasOwn(patch, "fileName") || Object.hasOwn(patch, "format")
          ? { edits: {} }
          : {}),
      })),
    [],
  );
  const { overrides, config, error } = resolved;

  const value: Store = {
    api,
    screen,
    go,
    overrides,
    config,
    ...(error && { configError: error }),
    set,
    cards,
    cardsLoading,
    ...(cardsError && { cardsError }),
    refreshCards,
    forceRefreshCards: reloadCards,
    books,
    setBooks,
    draft,
    setDraft,
    results,
    setResults,
    syncResult,
    setSyncResult,
    syncBusy,
    setSyncBusy,
    syncError,
    setSyncError,
    reviewDrafts,
    setReviewDraft,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
