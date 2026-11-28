import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "./panel.css";
import { BookOpen, Sparkles } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "../../ui/src/lib/store.tsx";
import { useTheme } from "../../ui/src/lib/theme.ts";
import { SyncScreen } from "../../ui/src/screens/Sync.tsx";
import { connections, extensionApi, forgetCachedReads, openInLibby } from "./extension-api.ts";
import { FABLE_SIGN_IN_URL } from "./fable-get.ts";
import { postToFable } from "./fable-review.ts";
import { LIBBY_URL } from "./libby-session.ts";

const CHECK_MS = 3_000;
const APPS = [
  { key: "libby", name: "Libby", icon: BookOpen, signInUrl: LIBBY_URL },
  { key: "fable", name: "Fable", icon: Sparkles, signInUrl: FABLE_SIGN_IN_URL },
] as const;

/** Show each provider’s connection status and link to sign in when needed. */
export function Connections() {
  const [state, setState] = useState<Awaited<ReturnType<typeof connections>>>();
  const [checkFailed, setCheckFailed] = useState(false);
  const { forceRefreshCards } = useStore();
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
  useEffect(() => {
    if (state?.libby === undefined) return;
    // The account may have changed in the Libby tab, so reads kept for the old one no longer apply.
    forgetCachedReads();
    forceRefreshCards();
  }, [state?.libby, forceRefreshCards]);
  return (
    <div>
      <ul className="flex items-center gap-1.5" aria-label="Library connections">
        {APPS.map(({ key, name, icon: Icon, signInUrl }) => {
          const status = checkFailed
            ? "Could not check connection"
            : !state
              ? "Checking"
              : state[key]
                ? "Connected"
                : "Sign in";
          const label = `${name}: ${status}`;
          const content = (
            <>
              <Icon className="size-3" aria-hidden="true" />
              {name}
            </>
          );
          const style = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold";
          return (
            <li key={key}>
              {!checkFailed && state && !state[key] ? (
                <a
                  className={`${style} bg-warning text-warning-content underline`}
                  aria-label={label}
                  title={label}
                  href={signInUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {content}
                </a>
              ) : (
                <span
                  role="status"
                  className={`${style} ${checkFailed ? "bg-error text-error-content" : state ? "bg-success text-success-content" : "bg-base-200"}`}
                  aria-label={label}
                  title={label}
                >
                  {content}
                  <span className={checkFailed ? "" : "sr-only"}>: {status}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!checkFailed && state?.libbyProblem && <p className="mt-1 text-xs">{state.libbyProblem}</p>}
    </div>
  );
}

function Panel() {
  useTheme();
  return (
    <>
      <header className="flex items-start justify-between gap-2 px-2 pt-2">
        <Connections />
        <a
          className="btn btn-ghost btn-xs shrink-0"
          href={chrome.runtime.getURL("src/full-app.html")}
          target="_blank"
          rel="noreferrer"
        >
          Open app
        </a>
      </header>
      <main className="p-2">
        <SyncScreen openLoan={openInLibby} postReview={postToFable} compactLayout />
      </main>
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StoreProvider api={extensionApi}>
        <Panel />
      </StoreProvider>
    </StrictMode>,
  );
}
