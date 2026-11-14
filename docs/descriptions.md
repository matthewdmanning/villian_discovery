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

## `parseSnapshots` — src/sync.ts

Use this function to validate one provider's snapshots and reject duplicate canonical book IDs.
Inputs: `input` — untrusted provider snapshot data; `provider` — provider name used in duplicate-ID errors.
Dependencies: `BookSnapshotSchema`, `z.array`.

## `BookSnapshotSchema` refinement — src/sync.ts

Use this validation to reject out-of-range reading progress and non-boolean authoritative status values at the snapshot trust boundary.
Inputs: `book` — a structurally valid snapshot; `ctx` — Zod validation context for reporting field errors.
Dependencies: `SnapshotFieldSchema`, Zod refinement context.

## `reconcileSnapshots` — src/sync.ts

Use this function to reconcile validated Libby and Fable snapshots into deterministic per-book, per-field rows.
Inputs: `libby` — untrusted Libby snapshot array; `fable` — untrusted Fable snapshot array.
Dependencies: `parseSnapshots`, `BookSnapshotSchema`.

## `displayValue`, `SourceValue` — ui/src/screens/Sync.tsx

Use these functions to display a normalized field and its source's edit timestamp without confusing unknown and cleared values.
Inputs: `value` — a normalized value or source field; `field` — its canonical field name.
Dependencies: `SyncField`, `displayValue` for source rendering.

## `SyncScreen`, `SyncScreen.sync` — ui/src/screens/Sync.tsx

Use these functions to compare library snapshots and retain the last successful comparison while displaying fetch errors.
Inputs: None; state and the API come from `useStore`.
Dependencies: `useStore`, `api.sync`, `setSyncResult`, `Screen`, `Panel`, `SourceValue`.

## `demoApi.sync` — ui/src/lib/api.ts

Use this method to preview reconciliation with deterministic example snapshots.
Inputs: None.
Dependencies: `reconcileSnapshots`, `wait`.
