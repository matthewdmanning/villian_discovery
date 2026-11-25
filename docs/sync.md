# Library sync

Sync follows **Preview → Review conflicts → Apply**. The browser demo uses simulated accounts; it never reads or changes real Libby or Fable data. Live writes remain unavailable until the specific provider contracts and authenticated runtime connection have been verified. [Current contract evidence](sync-contracts.md).

The web app and Chrome extension share sync preview, apply, and settings coordination. Each keeps its own sign-in and settings storage; saving settings invalidates previous previews.

## User settings and fallback file

The application ships `src/sync.fallbacks.json` (copied into `dist/` when built). Each user's saved overrides are validated and merged over this file, one field at a time. There is no repository, current-directory, project-config, or hidden schema-default dependency.

| Setting                        | Shipped fallback                                                |
| ------------------------------ | --------------------------------------------------------------- |
| Shared metadata                | All compatible shared fields                                    |
| Matching                       | Verified identifiers, then unambiguous normalized work matching |
| Libby progress across editions | Furthest known progress                                         |
| Undated conflicts              | Ask for each conflict                                           |
| Removals                       | None                                                            |
| Show non-conflicting changes   | No                                                              |
| Allow decrease in progress     | No (Advanced): progress never moves to a lower value            |

For example, a user may save `{ "version": 1, "removals": "fields-memberships" }`; remaining fields inherit the shipped file. Unknown settings, invalid values, null configuration objects, and incomplete fallback files produce errors rather than silently changing policy. Using the fallback settings is an explicit reset of the user's overrides.

The browser demo stores overrides under an account-specific local-storage key. Production storage and deployment remain undecided; this is not a choice of hosted or desktop architecture. Production must supply authenticated user-scoped settings, provider sessions, plans, and durable operation outcomes. Settings do not contain provider credentials.

## Reading state and matching

Libby is authoritative for progress, checked-out status, and finished status. Under the shipped progress policy, a matched work uses the furthest known progress, any active loan, and any explicit finished state across its editions/formats.

Fable receives **Finished** first when Libby explicitly marks the work finished. Otherwise, **Currently Reading** requires known not-finished state, an active Libby loan, and progress greater than zero. Zero progress and returned books do not imply Currently Reading. Unknown data cannot be converted into zero, false, or a permission to change Fable's status. Clearing a previous status must be previewed and checked against the removal policy; do not invent a Want to Read replacement.

Verified shared IDs/ISBNs take precedence over exact normalized title-and-author work matching. Ambiguous identities are shown for review. Similar titles alone are insufficient. Passage annotations require a verified compatible edition and location anchor even when the overall work matches.

## Metadata and proposed changes

For compatible metadata, newer actual field edit timestamps win. Missing or equal timestamps on conflicting values need a choice unless the user's settings explicitly select a provider preference. Fetch time and list-level edit times are not field edit times.

Explicit null represents a field clearing. Reduced string-array membership represents a removal. Removals are blocked under the shipped policy; enabling them still requires a clearly marked preview and explicit approval. Unsupported data and unverified operations remain visible and blocked.

Apply must re-read both sources and revalidate settings, connected accounts, capabilities, and affected data before writing. Changed inputs require a new preview. Per-operation results distinguish successful, failed, uncertain, and skipped writes; partial success is not reported as a complete sync. An ambiguous timeout is verified against the destination before a retry, and completed operations are not replayed.

Sync never borrows, returns, renews, or places holds. Existing discovery/export commands remain read-only.

## App schemas

Each app has its own schema. Every source app adapter must have a schema converter:

- `fields` lists the shared field names the app has.
- `read()` converts the app's native records into those shared fields.
- Fields outside an app's schema are dropped on read.

**Rule: never flag incompatible fields.** A field that one app does not have is not a conflict, a block, or an "Unknown" value. Sync skips it for that app, and the UI does not show that app for that field. A field in an app's schema with no value is empty, and sync can fill it.

## Normalized snapshots

Provider snapshots use a stable `bookId`, descriptive `title`, optional `author`, ISBN/shared work identity, and per-field `{ value, updatedAt? }` records. Reading progress is a percentage from 0 to 100; checked-out and finished values are booleans. Ordinary values may be strings, finite numbers, booleans, null, or string arrays. Timestamps must be ISO date-times with timezone information.

Duplicate provider IDs, invalid reading values, and invalid timestamps are rejected. Title edits to be reconciled belong in a timestamped field; the snapshot title is also a display label.
