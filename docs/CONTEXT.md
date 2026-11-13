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
- Discover the API only from a HAR file that the user records while logged in. Use `site-check discover` (`src/discovery/har.ts`).
- Do not build crawlers or probes that run without login. Do not look for login workarounds.
- Usage and output format: [fable-discovery.md](fable-discovery.md).
