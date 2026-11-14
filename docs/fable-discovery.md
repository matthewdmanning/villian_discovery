# fable.co API discovery

## Before you start

- fable.co API calls require login.
- Install Google Chrome or Microsoft Edge for `export-lists` and `capture`.
- The tool keeps your login in `~/.config/libby-shelf/browser-profile`. The folder holds session cookies. Never copy it into the repo or share it.
- Close other tool browser windows before a new run. An open window locks the profile.

## Export your book lists

```sh
npm run build
npm run export:fable
```

1. A browser window opens on <https://fable.co/library>.
2. Log in if fable.co asks. The tool continues on its own after you log in.
3. The tool saves each list to `fable-lists/<list-name>.json`. The window then closes.

Each file is a libby-shelf book list: `{ "books": [{ "title", "author", "isbn" }] }`. Give a file to `libby-shelf` as its book list.

| Option        | Effect                                 |
| ------------- | -------------------------------------- |
| `--out <dir>` | Output folder. Default: `fable-lists`. |

The files hold your own lists. `.gitignore` excludes `fable-lists/`. Never commit them.

## Capture the API automatically

```sh
npm run build
npm run discover:fable
```

A browser window opens. Log in. The tool then opens site pages on its own and saves `fable-openapi.json`. It only follows links. It never clicks buttons or sends forms, so it sees `GET` requests only. Close the window to stop early.

| Option            | Effect                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `--host <h...>`   | Keep these hosts and their subdomains. Default: `fable.co`.                                       |
| `--out <file>`    | Output file. Default: `fable-openapi.json`.                                                       |
| `--max-pages <n>` | Max pages to open. Default: `30`.                                                                 |
| `--focus <p...>`  | Open links under these path prefixes first. Default: `/library`, `/book-list`, `/book`, `/books`. |

## Record a HAR file

A HAR file holds session cookies and tokens. Never commit it. `.gitignore` excludes `*.har`.

1. Open fable.co in a browser. Log in.
2. Open DevTools. Select the **Network** tab.
3. Use the features to map: books, clubs, search, profile.
4. Select **Save all as HAR**. Save the file outside the repo.

The tool sees only the requests that you trigger.

## Run `discover`

```sh
npm run build
node dist/discovery/site-check-cli.js discover <file.har> --out fable-openapi.json
```

| Option          | Effect                                                      |
| --------------- | ----------------------------------------------------------- |
| `--host <h...>` | Keep these hosts and their subdomains. Default: `fable.co`. |
| `--all-hosts`   | Keep every host.                                            |
| `--out <file>`  | Write to a file. Default: stdout.                           |

## Output

An OpenAPI 3.1 document, built in `src/discovery/har.ts`:

- One path per method and path template. Digit, UUID and long-hex segments become `{id}`, `{id2}`, ….
- Inferred schemas for path and query parameters, JSON and form request bodies, and JSON responses per status code.
- `components.securitySchemes` from the `Authorization` scheme word, API-key header names and session-cookie names. The output never holds values.
- `security` per operation: one entry per auth combination seen. `{}` means some samples had no auth.
- `x-sample-count`: requests merged into the operation.

## Known limits

- Slug segments (for example `/users/jane`) stay literal and can leak names. Read the output before you commit it.
- Session cookies are found by name (`sess`, `auth`, `token`, `jwt`, `sid`). Other names are missed.
- GraphQL endpoints collapse into one `POST` operation. Add grouping by `operationName` if a real HAR shows GraphQL.
