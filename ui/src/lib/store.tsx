import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { InputFormat } from "../../../src/input.ts";
import { type BookRequest, type BookResult, demoApi, type LibbyApi, type LibbyCard } from "./api.ts";
import { type Config, type ConfigInput, resolve, setPath } from "./config.ts";
import { options, type ScreenId, screens } from "./spec.ts";

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
  api: LibbyApi;
  screen: ScreenId;
  go(id: ScreenId): void;
  overrides: ConfigInput;
  config: Config;
  configError?: string;
  set(path: string, value: unknown): void;
  cards: LibbyCard[];
  books: BookRequest[];
  setBooks(b: BookRequest[]): void;
  draft: BookDraft;
  setDraft(patch: Partial<BookDraft>): void;
  results: { rows: BookResult[]; dryRun: boolean } | undefined;
  setResults(r: { rows: BookResult[]; dryRun: boolean } | undefined): void;
}

const Ctx = createContext<Store | null>(null);
const KEY = "libby-shelf.config";

/** Saved overrides. The UI starts in dry run (wireframe default) until the user turns it off. */
function load(): ConfigInput {
  try {
    return { dryRun: true, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as ConfigInput) };
  } catch {
    return { dryRun: true };
  }
}

export function StoreProvider({ children, api = demoApi }: { children: ReactNode; api?: LibbyApi }) {
  const first = screens.some((s) => s.id === options.defaultScreen)
    ? options.defaultScreen
    : (screens[0]?.id ?? "books");
  const [screen, go] = useState<ScreenId>(first);
  const [resolved, setResolved] = useState(() => {
    const overrides = load();
    return { overrides, ...resolve(overrides) };
  });
  const [cards, setCards] = useState<LibbyCard[]>([]);
  const [books, setBooks] = useState<BookRequest[]>([]);
  const [draft, setDraftState] = useState<BookDraft>({ text: "", format: "auto", edits: {} });
  const [results, setResults] = useState<Store["results"]>();

  useEffect(() => {
    api.cards().then(setCards, () => setCards([]));
  }, [api]);

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
    books,
    setBooks,
    draft,
    setDraft,
    results,
    setResults,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
