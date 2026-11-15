# Libby integration audit fixes

The November 15, 2026 audit identified 18 issues in the Libby implementation and preview UI. The changes below address that audit; they do not establish a supported public Libby API or guarantee future private-endpoint compatibility.

## Device connection

The normal flow follows Libby's official [Setting up Libby on another device](https://help.libbyapp.com/en-us/6070.htm) and [sync recovery](https://help.libbyapp.com/en-us/6137.htm) instructions: the new device displays a code, and the existing device accepts it through Menu → Copy To Another Device → Enter Setup Code.

The private protocol was checked against the web client served at `https://libbyapp.com/dewey-22.2.1/src/main.js`: the receiving-device role is `pointer`; approval returns a `blessing`; completing `chip/clone` precedes identity refresh and shelf sync. This is observed client behavior, not an official API specification. Pairing tests use local fake responses; no real account pairing or borrowing is part of the suite.

## Audit coverage

| Issue                                       | Change                                                                                                                                                             | Regression coverage                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1. Reversed setup-code flow                 | CLI and UI display codes for entry on the existing device; polling supports rotation, timeout and cancellation                                                     | `test/auth-pairing.test.ts`, CLI and UI smoke checks                          |
| 2. Missing clone completion                 | Consume approval, complete cloning, refresh identity, verify cards, then persist; failed attempts restore the previous identity                                    | `test/auth-pairing.test.ts`, `test/runner.test.ts`, CLI smoke                 |
| 3. False non-Latin matches                  | Preserve Unicode letters/numbers and reject empty normalized comparisons                                                                                           | `test/matcher.test.ts`                                                        |
| 4. Discarded available formats              | Preserve ranked matching editions until availability/eligibility planning                                                                                          | `test/libby-regressions.test.ts`                                              |
| 5. Narrators treated as authors             | Use author/writer roles when contributor roles are present                                                                                                         | `test/matcher.test.ts`                                                        |
| 6. Missing ISBN fallback                    | Fall back to title search when no ISBN result passes matching                                                                                                      | `test/libby-regressions.test.ts`                                              |
| 7. Incorrect dry-run totals                 | Simulate card slots, run limits and existing titles without writes                                                                                                 | `test/libby-regressions.test.ts`, `test/ui-api.test.mjs`                      |
| 8. Stale availability cache                 | Fetch fresh catalog data for each search                                                                                                                           | `test/libby-regressions.test.ts`                                              |
| 9. Ambiguous write replay                   | Retry GETs only; reconcile loan/hold writes against shelf state; abort unresolved outcomes; restrict borrow-to-hold fallback to a confirmed availability rejection | `test/libby-regressions.test.ts`                                              |
| 10. Ignored failFast                        | Stop hold/suspension failures when configured                                                                                                                      | `test/libby-regressions.test.ts`                                              |
| 11. Swallowed suspension auth errors        | Preserve the placed hold, then abort on authentication failure; nonfatal suspension failures produce a separate error result                                       | `test/libby-regressions.test.ts`                                              |
| 12. Lost partial reports                    | Emit each completed target before continuing and preserve partial CLI/file reports on fatal errors                                                                 | `test/libby-regressions.test.ts`, CLI smoke in JSON, NDJSON and table formats |
| 13. Silent nested config typos              | Validate nested configuration objects strictly                                                                                                                     | `test/config.test.ts`                                                         |
| 14. Final deselection selects all           | Keep at least one card selected; disable deselection of the final selected card                                                                                    | `test/ui-behavior.test.mjs`, UI smoke                                         |
| 15. Pasted JSON object treated as text      | Detect both supported JSON forms in auto mode                                                                                                                      | `test/ui-behavior.test.mjs`, UI smoke                                         |
| 16. Stale cards after login/account changes | Refresh after login, token-file changes and successful runs; ignore superseded loads                                                                               | UI smoke                                                                      |
| 17. Endless cards spinner                   | Separate loading, failure and empty states, with retry/refresh controls                                                                                            | UI smoke                                                                      |
| 18. Duplicate library priority rows         | Build the priority list from unique library keys                                                                                                                   | `test/ui-behavior.test.mjs`, UI smoke                                         |

## Verification

Use the Node version in `.nvmrc`.

- `npm run ci`: formatting/lint, typecheck, unit tests, library build and the built CLI smoke test.
- `npm run build --prefix ui`: UI typecheck and production build.
- With the UI dev server running, `npm run test:ui`: browser regression checks. Set `BROWSER_EXECUTABLE_PATH` to an installed Chromium binary when Chrome is unavailable.

The UI remains a marked demo until a production `LibbyApi` backend is supplied. Its pairing and card-loading interface supports cancellation and account-specific refreshes; the demo never contacts Libby.
