# Project context

Agent context: specs, configs, preferences and rules for this repo.

## Where context lives

- Store project specs, configs, preferences and rules in `docs/`. Do not store them in a tool-specific folder (for example, a Claude memory folder).
- Store agent information and directions in this file.
- Keep `README.md` files for users only. Never store agent information or directions in them.

## Git

- Never create git worktrees. To work on another branch, stash or commit the current changes, then switch branches in the one checkout.

## fable.co API discovery

- fable.co API calls require login. There is no workaround. This is not a blocker.
- Use only the user's own logged-in browser session. The user logs in. The tool never logs in for the user. Three commands are allowed:
  - `site-check discover` (`src/discovery/har.ts`): infers the API from a HAR file that the user records.
  - `site-check capture` (`src/discovery/capture.ts`): opens the saved browser profile, waits for a login, and follows links. It sends GET requests only. It never clicks buttons or sends forms.
  - `site-check export-lists` (`src/discovery/export-lists.ts`): reads the user's lists through the cookie-authenticated `fable.co/api` endpoints that the Library page uses.
- `src/discovery/browser.ts` owns the saved profile, browser launch and window-close tracking. Both browser commands use it.
- Do not build crawlers or probes that run without login. Do not look for login workarounds.
- Usage and output format: [fable-discovery.md](fable-discovery.md).

## Web UI (`ui/`)

- Stack: Vite + React + Tailwind 4 + daisyUI 5. Own `package.json`; imports library code from `../src`.
- Theme `shelfie` / `shelfie-night`: tokens in `ui/src/index.css`. Components use only semantic tokens (daisyUI color names, `pop`, `font-display`/`font-sans`). No raw colors or palette classes; `test/ui-tokens.test.ts` enforces.
- Screens, labels and nav come from `docs/wireframes/libby-ui.wireframe.json`. Field choices, defaults and ranges come from `ConfigSchema`.
- Data goes through the `LibraryApi` interface (`ui/src/lib/api.ts`). Only `demoApi` exists; it never calls Libby or Fable.
- Layout: safe-area padding (`pt-safe`, `px-safe`, `pb-safe`, `pb-dock`); tables collapse to cards below `md`.
- The Sync screen supports preview/review/apply against simulated accounts. `src/sync.ts` owns matching and precedence, `src/sync-plan.ts` owns guarded application, and shipped `src/sync.fallbacks.json` supplies settings defaults. User overrides are separate; no project config fallback. Live adapters remain unavailable until verified contracts and an authenticated runtime exist. See [sync.md](sync.md) and [sync-contracts.md](sync-contracts.md). There is no `sync` CLI command. Production deployment remains undecided.
- The Player screen is a browser-only audiobook control panel against a demo title (`DEMO_AUDIOBOOK`). No Libby audio is streamed. `ui/src/lib/player.ts` owns state as a pure reducer: play/pause, rewind/forward 30 s, speed ±0.05× (0.5–3×), bookmarks, chapter start/end. Chapter start within 3 s of the start goes to the previous chapter. Each bookmark has a note (≤2000 chars) and tags. Bookmark tags are a separate library (`tagLibrary`); never reuse Libby/Fable book tags. The tag dropdown lists library tags (scrollable; click toggles). Its last item, always visible, is "New Tag": the only way to create a tag. Tags: ≤32 chars, trimmed, unique ignoring case; a repeated name reuses the existing spelling. Tags filter the bookmark list. `restoreBookmarks` and `restoreTagLibrary` validate saved data. Position, speed and bookmarks persist in `localStorage` (`libby-shelf.player`).
