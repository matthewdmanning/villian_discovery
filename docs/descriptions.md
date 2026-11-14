## `createDemoRunner` — ui/src/lib/api.ts

Use this function to build the production runner backed by deterministic demo HTTP responses for one UI run.
Inputs: `config` — the resolved UI configuration; `books` — requests used to seed fake responses.
Dependencies: `LibbyClient`, `ThunderClient`, `Runner`, `demoFetch`, `silentLogger`.

## `demoFetch` — ui/src/lib/api.ts

Use this function to provide deterministic in-memory Libby and Thunder responses when the browser demo runs.
Inputs: `config` — the resolved UI configuration; `books` — requests used to identify search and title lookups.
Dependencies: `CARDS`, `fakeMedia`.

## `Cards.move`, `Cards.dragProps`, `Cards.priority` — ui/src/screens/Cards.tsx

Use these functions to move enabled libraries and render the inline drag and arrow controls shared by desktop and mobile card rows.
Inputs: `from` and `to` — library keys defining a move; `c` — the card whose controls are rendered.
Dependencies: `enabled`, `order`, `using`, `move`, and the configuration setter from `useStore`.
