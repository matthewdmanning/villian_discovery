## `createDemoRunner` — ui/src/lib/api.ts

Use this function to build the production runner backed by deterministic demo HTTP responses for one UI run.
Inputs: `config` — the resolved UI configuration; `books` — requests used to seed fake responses.
Dependencies: `LibbyClient`, `ThunderClient`, `Runner`, `demoFetch`, `silentLogger`.

## `demoFetch` — ui/src/lib/api.ts

Use this function to provide deterministic in-memory Libby and Thunder responses when the browser demo runs.
Inputs: `config` — the resolved UI configuration; `books` — requests used to identify search and title lookups.
Dependencies: `CARDS`, `fakeMedia`.
