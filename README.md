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

Option A — setup code (recommended):

1. Libby app → Menu → _Copy To Another Device_ → 8-digit code.
2. `libby-shelf login --code 12345678`

Token saved to `$XDG_CONFIG_HOME/libby-shelf/identity.json` (default `~/.config/...`), mode `600`. Override: `--token-file`, `auth.tokenFile`, or `LIBBY_TOKEN_FILE`.

Option B — existing token: `export LIBBY_IDENTITY_TOKEN=...` (libbyapp.com → DevTools → Local Storage → `dewey.sentry.identity`).

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
2. Match: ISBN match wins; else title similarity ≥ `minTitleScore` and author ≥ `minAuthorScore` (Dice bigrams; case, accents, articles, subtitles, name order ignored). Media type must be in `mediaTypes`; earlier type preferred.
3. Skip if already on loan/hold (`skipExisting`).
4. `action`:
   - `auto` — borrow first available library (priority order), else hold. Failed borrow → retries as hold.
   - `borrow` — borrow or skip.
   - `hold` — hold only.
5. Hold placement: `best` shortest estimated wait · `first` first owning library · `all` one per owning library.
6. Guards: card loan/hold limits (`respectCardLimits`), per-run caps (`borrow.maxPerRun`, `hold.maxPerRun`), `hold.maxEstimatedWaitDays`, `hold.maxHoldsCount`.

Per-book failures are reported and the run continues (`failFast` to stop). Auth failures (401/403) abort.

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
| `http.timeoutMs` / `retries` / `retryBaseMs` | `30000` / `2` / `500`   | retries on network, 429, 5xx; honours `Retry-After`                      |
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

## Endpoints used

| Purpose         | Request                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| new identity    | `POST sentry-read.svc.overdrive.com/chip?client=dewey`                                 |
| link setup code | `POST /chip/clone/code` (form `code`)                                                  |
| account state   | `GET /chip/sync`                                                                       |
| borrow          | `POST /card/{cardId}/loan/{titleId}` `{period, units:"days", lucky_day, title_format}` |
| hold            | `POST /card/{cardId}/hold/{titleId}` `{days_to_suspend:0, email_address}`              |
| suspend hold    | `PUT /card/{cardId}/hold/{titleId}` `{days_to_suspend}`                                |
| search          | `GET thunder.api.overdrive.com/v2/libraries/{key}/media?query                          | identifier&mediaTypes&x-client-id=dewey` |
| title lookup    | `GET .../v2/libraries/{key}/media/{titleId}`                                           |

Sources: [ping/libby-calibre-plugin](https://github.com/ping/libby-calibre-plugin) (based on [lullius/pylibby](https://github.com/lullius/pylibby)), [mknabe/book-club](https://github.com/mknabe/book-club).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Quick: `npm ci && npm run ci`.

Layout: `src/` `http` (fetch, retries) · `libby-client` · `thunder-client` · `config` (zod) · `input` · `matcher` · `planner` (pure decisions) · `runner` (orchestration) · `report` · `auth` · `cli`.

Security: [SECURITY.md](SECURITY.md).

Export your fable.co book lists, or discover the fable.co API: [docs/fable-discovery.md](docs/fable-discovery.md).
