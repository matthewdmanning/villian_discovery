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
