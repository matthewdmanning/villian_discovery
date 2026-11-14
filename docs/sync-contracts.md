# Live sync contract verification

Live writes are unavailable until the particular provider operation is verified. A successful login or readable endpoint does not verify a write operation.

## Current evidence

An authenticated, GET-only check of the existing Fable endpoints succeeded on 2026-11-14. Only inferred response schemas were saved locally; credentials and response values were not retained.

| Read                          | Observed fields                                                                                                                                 | Limits                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Fable `/api/me/book-lists`    | List identity, name, privacy, `updated_at`                                                                                                      | The edit time belongs to the list; it is not evidence of when a book's rating, note, or progress changed.                                 |
| Fable `/api/lists/{id}/books` | Book identity/ISBN/authors, `reading_progress.current_percentage`, `reading_progress.status`, `user_rating`; entry `note` and `note_visibility` | Sampled field shapes only. Status values, write payloads, privacy semantics, and per-field edit times still require verification.         |
| Libby `chip/sync`             | Existing client supports cards, loans, and holds                                                                                                | No existing Libby identity was available for this verification run. Reading history, completion, and progress mappings remain unverified. |

No live metadata write operation is verified. The demo uses simulated providers and must never be presented as account synchronization.

## Verifying a capability

1. Sign in yourself using your own provider session. For Libby, the existing setup-code login command can establish an identity; do not place tokens or setup codes in source files.
2. Record browser Network traffic while you personally make one reversible change. Cover list/tag membership, ordinary notes, progress/status, privacy, and clearing separately. Passage annotations need their edition and location anchors checked separately.
3. Establish the exact method, path, request/response shapes, required headers, before/after values, edit timestamps or versions, and a confirming read. Do not infer a write endpoint from a readable URL.
4. Check whether the operation implicitly removes memberships, changes visibility, duplicates on retry, or affects circulation. Sync must not call borrow/return/renew/hold operations.
5. Keep raw HAR captures outside version control. The existing `site-check discover` command produces value-free schemas, but account-specific path segments still need review before any evidence is committed.
6. Enable only the verified field-level operation in the trusted provider adapter and add an HTTP-faked regression check. A missing field, unknown timestamp, expired login, or incomplete read cannot be treated as a deletion or a default value.

The authenticated runtime, credential/session storage, and deployment model remain separate decisions. Production must scope connections, user settings, plans, and durable operation outcomes to the authenticated user. The browser demo's storage and in-memory providers are not production implementations.
