import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./panel.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AudiobookRow } from "../../src/libby-audiobooks.ts";
import { StoreProvider, useStore } from "../../ui/src/lib/store.tsx";
import { useTheme } from "../../ui/src/lib/theme.ts";
import { SyncScreen } from "../../ui/src/screens/Sync.tsx";
import { audiobooks, connections, extensionApi, openInLibby } from "./extension-api.ts";
import { FABLE_SIGN_IN_URL } from "./fable-get.ts";
import { LIBBY_URL } from "./libby-session.ts";

const CHECK_MS = 3_000;
const AUDIOBOOK_MS = 30_000;
const APPS = [
  { key: "libby", name: "Libby", signInUrl: LIBBY_URL },
  { key: "fable", name: "Fable", signInUrl: FABLE_SIGN_IN_URL },
] as const;

/** Use this component for one line per app: its name, then its state or a sign-in link. The panel re-checks on its own, so no confirm button exists. */
function Connections() {
  const [state, setState] = useState<Awaited<ReturnType<typeof connections>>>();
  const [checkFailed, setCheckFailed] = useState(false);
  const { refreshCards } = useStore();
  useEffect(() => {
    let active = true;
    const check = () =>
      connections()
        .then((next) => {
          if (active) {
            setCheckFailed(false);
            setState((previous) =>
              previous?.libby === next.libby &&
              previous.fable === next.fable &&
              previous.libbyProblem === next.libbyProblem
                ? previous
                : next,
            );
          }
        })
        .catch(() => {
          if (active) setCheckFailed(true);
        });
    void check();
    const timer = setInterval(check, CHECK_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Libby's sign-in state is the trigger that reloads cards.
  useEffect(() => void refreshCards(), [state?.libby, refreshCards]);
  return (
    <ul className="px-4 pt-4">
      {APPS.map(({ key, name, signInUrl }) => (
        <li key={key} className="flex items-center gap-2 py-1">
          <span className="font-display font-semibold">{name}</span>→
          {checkFailed ? (
            <span className="text-sm text-error">Could not check connection</span>
          ) : state === undefined ? (
            <span className="opacity-60">Checking…</span>
          ) : state[key] ? (
            <span>connected</span>
          ) : (
            <a className="link" href={signInUrl} target="_blank" rel="noreferrer">
              Sign in
            </a>
          )}
          {!checkFailed && key === "libby" && state?.libbyProblem && (
            <span className="text-sm opacity-60">{state.libbyProblem}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Use this component for the real Libby audiobook loans, one line each: title, then status, then a link into Libby. A failed read shows its reason, never an empty list. */
function Audiobooks() {
  const [rows, setRows] = useState<AudiobookRow[]>();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await audiobooks();
        if (active) {
          setRows(next);
          setProblem("");
        }
      } catch (error) {
        if (active) {
          setRows(undefined);
          setProblem(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void load();
    const timer = setInterval(load, AUDIOBOOK_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (problem) return <p className="px-4 pt-4 text-sm opacity-70">Could not read audiobooks: {problem}</p>;
  if (!rows) return <p className="px-4 pt-4 opacity-60">Loading audiobooks</p>;
  if (!rows.length) return <p className="px-4 pt-4 opacity-60">No audiobooks checked out</p>;
  return (
    <ul className="px-4 pt-4">
      {rows.map((row) => (
        <li key={row.titleId} className="flex flex-wrap items-center gap-2 py-1">
          <div className="min-w-0">
            <span className="font-display font-semibold">{row.title}</span>
            {row.narrators?.length ? (
              <span className="block text-sm opacity-70">Narrated by {row.narrators.join(", ")}</span>
            ) : null}
          </div>
          →<span>{row.progress === undefined ? row.status : `${row.status}, ${row.progress}%`}</span>
          {row.url && (
            <button type="button" className="link" onClick={() => void openInLibby(row.url as string)}>
              Open in Libby
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Panel() {
  useTheme();
  return (
    <>
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <h1 className="font-display text-xl font-semibold">Libby Shelf</h1>
        <a
          className="btn btn-primary btn-sm"
          href={chrome.runtime.getURL("src/full-app.html")}
          target="_blank"
          rel="noreferrer"
        >
          Open app
        </a>
      </header>
      <Connections />
      <Audiobooks />
      <main className="px-4 py-4">
        <SyncScreen />
      </main>
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StoreProvider api={extensionApi}>
      <Panel />
    </StoreProvider>
  </StrictMode>,
);
