# libby-shelf

TypeScript CLI + library. Input: book list. Output: Libby loans or holds, per configurable policy.

> **Unofficial.** Libby has no public API. This tool calls the same private endpoints as libbyapp.com. They may change without notice. Use on your own account, at a polite pace, per your library's terms.

## Requirements

Node ^26.6 (see `.nvmrc`).

## Install

```sh
npm install
npm run build
npm link        # optional: puts `libby-shelf` on PATH
```

## Authenticate (once)

Option A — browser sign-in (recommended): run `libby-shelf login`. A Chrome or Edge window opens libbyapp.com. Follow Libby's own steps there ([Setting up Libby on another device](https://help.libbyapp.com/en-us/6070.htm)). The command ends when Libby shows your cards.

Option B — setup code, no browser:

1. Run `libby-shelf login --device-code`. This tool displays an 8-digit setup code.
2. On your existing Libby device, open Menu → _Copy To Another Device_ → _Enter Setup Code_, then enter the displayed code.
3. Leave the command running until approval completes. It refreshes the linked identity before saving the token. Codes refresh automatically; login times out after five minutes, and Ctrl+C cancels it.

For an original device that explicitly offers a displayed code, `login --code <code>` remains an optional input-code flow. It also completes approval before saving.

Token saved to `$XDG_CONFIG_HOME/libby-shelf/identity.json` (default `~/.config/...`), mode `600`. Override: `--token-file`, `auth.tokenFile`, or `LIBBY_TOKEN_FILE`.

Option C — existing token: `export LIBBY_IDENTITY_TOKEN=...` (libbyapp.com → DevTools → Local Storage → `dewey:sentry.identity`).

Never commit tokens. `.gitignore` excludes `.libby/`, `*.identity.json`, root `libby.config.json`.

## Usage

```sh
libby-shelf cards                                   # cards, library keys, usage vs limits
libby-shelf search Project Hail Mary by Andy Weir   # show matches per library; changes nothing
libby-shelf run books.txt --dry-run                 # plan only
libby-shelf run books.txt books.csv -c libby.config.json
libby-shelf run -b "Dune by Frank Herbert" -a hold --placement all
cat list.txt | libby-shelf run - -o ndjson
libby-shelf config                                  # effective merged config
libby-shelf schema > libby.config.schema.json       # JSON Schema for editor completion
```

Exit codes: `0` ok · `1` some books errored · `2` fatal (config, auth, input).

## Input formats

Detected by extension; force with `--input-format`.

| Format               | Shape                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| text (`.txt`, other) | one per line; `#` comments                                                                                |
| CSV/TSV              | header row; columns `title, author, isbn, titleId, format, action, libraries`; lists split on `;` or `\|` |
| JSON                 | `[...]` or `{ "books": [...] }`; items are text lines or objects with the CSV fields                      |

Text line forms: `Title by Author` · `Title - Author` · `Title — Author` · `Title \| Author` · `Title<TAB>Author` · `Title` · `isbn:978…` · bare ISBN-10/13 · `id:<titleId>` · Libby/OverDrive title URL.

Per-book fields `format`, `action`, `libraries` override config for that book. See `examples/`; title ids there are placeholders.

## Decision logic

Per book:

1. Search each selected library (Thunder catalog). Order: `titleId` lookup → ISBN identifier search → `title author` text search.
2. Match: ISBN match wins; else title similarity ≥ `minTitleScore` and author ≥ `minAuthorScore` (Dice bigrams; case, accents, articles, subtitles, name order ignored). Media type must be in `mediaTypes`; earlier type preferred among equally suitable editions. Matching editions remain available to the planner so an available accepted format can be borrowed.
3. Skip if already on loan/hold (`skipExisting`).
4. `action`:
   - `auto` — borrow first available library (priority order), else hold. Confirmed `TitleNoLongerAvailable` rejection → try a hold. Uncertain writes are checked against the shelf; unresolved outcomes abort.
   - `borrow` — borrow or skip.
   - `hold` — hold only.
5. Hold placement: `best` shortest estimated wait · `first` first owning library · `all` one per owning library.
6. Guards: card loan/hold limits (`respectCardLimits`), per-run caps (`borrow.maxPerRun`, `hold.maxPerRun`), `hold.maxEstimatedWaitDays`, `hold.maxHoldsCount`.

Per-book failures are reported and the run continues (`failFast` to stop). Auth failures (401/403) abort, including failed hold suspension. Completed actions are retained in streamed and file reports if a later action aborts. A placed hold whose suspension fails is preserved as `held` and the failure is reported separately.

Dry runs simulate counters, card slots, and existing-title checks across the entire list. They send no account writes. Catalog results refresh between searches and runs.

Network/5xx retries apply to GET requests only. Account writes are never blindly replayed: a lost response triggers shelf reconciliation for borrows and holds, and the run stops if the outcome remains uncertain.

## Configuration

Layers, later wins: defaults < config file (`-c`, else `./libby.config.json`) < env < CLI flags. Unknown keys rejected. Full example: `examples/libby.config.json`.

| Key                                          | Default                 | Meaning                                                                  |
| -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `action`                                     | `auto`                  | `auto` \| `borrow` \| `hold`                                             |
| `libraries`                                  | all cards               | library keys (`cards` shows them), priority order; also filters          |
| `cards`                                      | all                     | card ids or names to use                                                 |
| `mediaTypes`                                 | `["ebook","audiobook"]` | accepted types, preference order; also `magazine`                        |
| `borrow.lendingPeriod`                       | `preference`            | `preference` (card setting) \| `max` \| days (snapped to offered option) |
| `borrow.luckyDay`                            | `true`                  | allow Lucky Day copies                                                   |
| `borrow.maxPerRun`                           | —                       | loan cap per run; then `auto` holds instead                              |
| `hold.placement`                             | `best`                  | `best` \| `first` \| `all`                                               |
| `hold.maxEstimatedWaitDays`                  | —                       | skip longer waits                                                        |
| `hold.maxHoldsCount`                         | —                       | skip longer queues                                                       |
| `hold.suspendDays`                           | `0`                     | deliver later after placing: 0–30, 60, 90                                |
| `hold.emailAddress`                          | —                       | email stored on hold                                                     |
| `hold.maxPerRun`                             | —                       | hold cap per run                                                         |
| `matching.minTitleScore`                     | `0.85`                  | 0–1                                                                      |
| `matching.minAuthorScore`                    | `0.6`                   | 0–1, when author given                                                   |
| `matching.ignoreSubtitle`                    | `true`                  | compare main title only                                                  |
| `matching.allowPreRelease`                   | `true`                  | allow pre-release titles                                                 |
| `matching.perPage`                           | `24`                    | results examined per library                                             |
| `skipExisting`                               | `true`                  | skip titles already on shelf                                             |
| `respectCardLimits`                          | `true`                  | skip cards at limit                                                      |
| `dryRun`                                     | `false`                 | plan only                                                                |
| `delayMs`                                    | `750`                   | pause between books                                                      |
| `failFast`                                   | `false`                 | stop on first error                                                      |
| `http.timeoutMs` / `retries` / `retryBaseMs` | `30000` / `2` / `500`   | GET retries on network, 429, 5xx; honours `Retry-After`                  |
| `http.userAgent`                             | Safari UA               | request UA                                                               |
| `http.sentryBaseUrl` / `thunderBaseUrl`      | see below               | endpoint overrides                                                       |
| `output.format`                              | `table`                 | `table` \| `json` \| `ndjson`                                            |
| `output.reportFile`                          | —                       | also write JSON report                                                   |
| `logLevel`                                   | `info`                  | logs go to stderr                                                        |
| `auth.identityToken` / `auth.tokenFile`      | — / XDG path            | see Authenticate                                                         |

Env: `LIBBY_IDENTITY_TOKEN`, `LIBBY_TOKEN_FILE`, `LIBBY_DRY_RUN`.

## Library API

```ts
import { processBooks, parseBooks } from "libby-shelf";

const books = parseBooks("Piranesi by Susanna Clarke\nisbn:9780593135204", "text");
const results = await processBooks(books, { action: "hold", hold: { placement: "all" }, dryRun: true });
```

Lower level: `LibbyClient`, `ThunderClient`, `Runner`, `planBook` (pure), `bestMatch`. `fetch` is injectable.

## Web UI (preview)

`ui/` = browser shell over the library, one screen per CLI command. Layout and screens follow [`docs/wireframes`](docs/wireframes/README.md).

```sh
cd ui && npm install && npm run dev
```

Runs on built-in demo data (`demo` badge): nothing reaches Libby. Demo pairing displays a sample code and completes automatically.

Search groups editions with the same title and author so you can compare their formats and libraries. **Best match** ranks titles by their strongest visible edition, with exact ISBN hits first. In live Search, an ISBN lookup includes other editions when the full catalog title and all credited author IDs agree. Exact ISBN results stay visible if a library's alternate-edition lookup fails or the catalog cannot confirm the credits.
Audiobook options in Search and audiobook entries on the Shelf show narrator credits when available.

To use your real accounts on Windows, double-click `Start libby-shelf.cmd`. It installs what is missing, starts a local server on <http://127.0.0.1:8787>, and opens it. On other systems, run `npm ci && npm ci --prefix ui && npm run live`. Connect Libby opens libbyapp.com for your sign-in on its own; "phone code" shows a setup code in the app instead. Sync compares on its own when it opens; the first comparison opens a browser window for your Fable login. Settings save as you change them. Live sync only reads: every write stays blocked until its contract is verified ([docs/sync-contracts.md](docs/sync-contracts.md)). Login, token-file changes, and completed runs refresh card data. Refresh, Retry, and Preview changes wait 10 s after each load and show a countdown; the server likewise reuses identical Libby, Fable, and catalog reads for 10 s, and any write clears them. At least one card must stay selected because an empty CLI card filter means all cards.

Book drafts and per-row edits survive screen navigation for the current tab. Changing the input or its format clears row overrides. Invalid rules block runs until corrected. Demo plans use the library planner, including card limits, per-run limits, and lending periods.

Library cards includes priority ordering in the card list, highest first. Unchecked cards stay at the bottom and cannot be reordered. At least one card must remain selected; cards from the same library share its priority.

Build the UI with `npm run build --prefix ui`; CI checks both the library and UI. On Windows, tests skip the POSIX-only token permission assertion while still checking token file round-trips.

With the UI dev server running and Chrome installed, `npm run test:ui` checks draft preservation, independent duplicate rows, invalid rules, and API error feedback. Set `UI_URL` for another server address, `BROWSER_CHANNEL=msedge` to use Edge, or `BROWSER_EXECUTABLE_PATH` for an installed Chromium executable.

The **Sync libraries** tab uses Preview → Review → Apply. Libby controls reading state; Finished wins, otherwise Currently Reading requires a checked-out book with positive progress. Other shared metadata uses actual edit recency, with conflicts shown for review. Per-user settings override a shipped fallback file; removals default to off and always require explicit review. The demo only changes simulated accounts. Live writes remain unavailable until provider contracts are verified. See [sync behavior and settings](docs/sync.md) and [contract verification](docs/sync-contracts.md).

## Endpoints used

| Purpose                 | Request                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| new identity            | `POST sentry.libbyapp.com/chip?client=dewey`                                              |
| setup-code display/poll | `GET /chip/clone/code` (`role=pointer`, optional `code`)                                  |
| optional input code     | `POST /chip/clone/code` (form `code`, `role=pointer`)                                     |
| complete pairing        | `POST /chip/clone` (form `blessing`), then authenticated `POST /chip` to refresh identity |
| account state           | `GET /chip/sync`                                                                          |
| borrow                  | `POST /card/{cardId}/loan/{titleId}` `{period, units:"days", lucky_day, title_format}`    |
| hold                    | `POST /card/{cardId}/hold/{titleId}` `{days_to_suspend:0, email_address}`                 |
| suspend hold            | `PUT /card/{cardId}/hold/{titleId}` `{days_to_suspend}`                                   |
| search                  | `GET thunder.api.overdrive.com/v2/libraries/{key}/media?query                             | identifier&mediaTypes&x-client-id=dewey` |
| title lookup            | `GET .../v2/libraries/{key}/media/{titleId}`                                              |

Sources: [ping/libby-calibre-plugin](https://github.com/ping/libby-calibre-plugin) (based on [lullius/pylibby](https://github.com/lullius/pylibby)), [mknabe/book-club](https://github.com/mknabe/book-club).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Quick: `npm ci && npm run ci`.

Layout: `src/` `http` (fetch, retries) · `libby-client` · `thunder-client` · `config` (zod) · `input` · `matcher` · `planner` (pure decisions) · `runner` (orchestration) · `report` · `auth` · `cli`.

Security: [SECURITY.md](SECURITY.md).

Export your fable.co book lists, or discover the fable.co API: [docs/fable-discovery.md](docs/fable-discovery.md).
