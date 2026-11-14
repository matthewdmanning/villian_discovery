import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ListChecks,
  Moon,
  Plug,
  Search,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { compact } from "./components/ui.tsx";
import { options, type ScreenId, screens } from "./lib/spec.ts";
import { useStore } from "./lib/store.tsx";
import { useTheme } from "./lib/theme.ts";
import { Books } from "./screens/Books.tsx";
import { Cards } from "./screens/Cards.tsx";
import { Connect } from "./screens/Connect.tsx";
import { Results } from "./screens/Results.tsx";
import { SearchScreen } from "./screens/Search.tsx";
import { Settings } from "./screens/Settings.tsx";

const VIEWS: Record<ScreenId, { icon: ComponentType<{ className?: string }>; short: string; view: () => ReactNode }> = {
  connect: { icon: Plug, short: "Connect", view: Connect },
  cards: { icon: CreditCard, short: "Cards", view: Cards },
  books: { icon: BookOpen, short: "Books", view: Books },
  settings: { icon: SlidersHorizontal, short: "Rules", view: Settings },
  search: { icon: Search, short: "Search", view: SearchScreen },
  results: { icon: ListChecks, short: "Results", view: Results },
};

const mobileOnly = options.layout === "mobile";
/** Breakpoint classes: desktop chrome from `lg` up, unless the spec forces the mobile layout. */
const desk = mobileOnly ? "hidden" : "hidden lg:flex";
const phone = mobileOnly ? "" : "lg:hidden";

export function App() {
  const { screen, go, api } = useStore();
  const [theme, toggleTheme] = useTheme();
  const View = VIEWS[screen].view;
  const idx = screens.findIndex((s) => s.id === screen);

  const brand = (
    <div className="flex items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="font-display text-xl font-semibold">libby-shelf</span>
      {api.demo && <span className="badge badge-accent badge-sm font-semibold">demo</span>}
    </div>
  );
  const themeBtn = (
    <button type="button" className="btn btn-ghost btn-circle" aria-label="Toggle theme" onClick={toggleTheme}>
      {theme === "shelfie" ? <Moon className="size-5" /> : <Sun className="size-5" />}
    </button>
  );

  return (
    <div className="flex min-h-dvh">
      {options.navigation === "sidebar" && (
        <aside
          className={`${desk} sticky top-0 h-dvh w-64 shrink-0 flex-col gap-6 border-e-2 border-pop bg-base-100 pt-safe pb-safe ps-[max(1rem,env(safe-area-inset-left))] pe-4`}
        >
          {brand}
          <nav aria-label="Screens">
            <ul className="menu w-full gap-1 p-0">
              {screens.map((s) => {
                const Icon = VIEWS[s.id].icon;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={s.id === screen ? "page" : undefined}
                      className={`gap-3 rounded-field py-2.5 font-display text-base ${s.id === screen ? "menu-active border-2 border-pop bg-primary text-primary-content shadow-pop-sm" : ""}`}
                      onClick={() => go(s.id)}
                    >
                      <Icon className="size-5" />
                      {s.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="mt-auto">{themeBtn}</div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`sticky top-0 z-20 flex items-center justify-between gap-3 border-b-2 border-pop bg-base-100/90 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 px-safe backdrop-blur ${options.navigation === "sidebar" && !mobileOnly ? "lg:hidden" : ""}`}
        >
          {brand}
          {options.navigation === "tabs" && (
            <nav aria-label="Screens" className={`${desk} tabs tabs-box gap-1 bg-base-200`}>
              {screens.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={s.id === screen ? "page" : undefined}
                  className={`tab font-display ${s.id === screen ? "tab-active" : ""}`}
                  onClick={() => go(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          )}
          {themeBtn}
        </header>

        {options.navigation === "wizard" && (
          <ul className={`${desk} steps steps-horizontal w-full px-safe pt-6`}>
            {screens.map((s, i) => (
              <li key={s.id} className={`step ${i <= idx ? "step-primary" : ""}`}>
                <button type="button" className="font-display text-sm" onClick={() => go(s.id)}>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        <main
          className={`flex-1 px-safe ${compact ? "py-5" : "py-6 sm:py-10"} pb-dock ${mobileOnly ? "" : "lg:pb-safe"} ${mobileOnly ? "mx-auto w-full max-w-md" : ""}`}
        >
          <View />
          {options.navigation === "wizard" && (
            <div className="mx-auto mt-8 flex w-full max-w-5xl justify-between">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={idx <= 0}
                onClick={() => go(screens[idx - 1]!.id)}
              >
                <ChevronLeft className="size-4" /> Back
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={idx >= screens.length - 1}
                onClick={() => go(screens[idx + 1]!.id)}
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </main>
      </div>

      <nav
        aria-label="Screens"
        className={`dock z-30 border-t-2 border-pop bg-base-100 pb-[env(safe-area-inset-bottom)] ${phone}`}
      >
        {screens.map((s) => {
          const Icon = VIEWS[s.id].icon;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === screen ? "page" : undefined}
              className={s.id === screen ? "dock-active font-semibold" : ""}
              onClick={() => go(s.id)}
            >
              <Icon className="size-5" />
              <span className="dock-label font-display">{VIEWS[s.id].short}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
