import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type BookRequest, type BookResult, demoApi, type LibbyApi, type LibbyCard } from "./api.ts";
import { type Config, type ConfigInput, resolve, setPath } from "./config.ts";
import { options, type ScreenId, screens } from "./spec.ts";

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
  const [overrides, setOverrides] = useState<ConfigInput>(load);
  const [cards, setCards] = useState<LibbyCard[]>([]);
  const [books, setBooks] = useState<BookRequest[]>([]);
  const [results, setResults] = useState<Store["results"]>();

  useEffect(() => {
    api.cards().then(setCards, () => setCards([]));
  }, [api]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(overrides));
    } catch {
      /* storage blocked: settings last for this tab only */
    }
  }, [overrides]);

  const set = useCallback((path: string, value: unknown) => setOverrides((o) => setPath(o, path, value)), []);
  const { config, error } = useMemo(() => resolve(overrides), [overrides]);

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
