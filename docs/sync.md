# Library sync

Sync follows **Preview → Review conflicts → Apply**. The browser demo uses simulated accounts; it never reads or changes real Libby or Fable data. Live writes remain unavailable until the specific provider contracts and authenticated runtime connection have been verified. [Current contract evidence](sync-contracts.md).

The web app and Chrome extension share sync preview, apply, and settings coordination. Each keeps its own sign-in and settings storage; saving settings invalidates previous previews.

**Sync** is the first screen in the navigation. Its first tab, **Shelf**, shows current Libby checkouts:

- A yellow background marks a book with unsynced changes or a match to review; synced books are muted. After a successful sync, the highlight and the progress change (shown beside the progress bar) clear.
- Under each title: author, narrators, and days left on the loan when Libby gives its end date.
- **Open in Libby** and **Open in Fable** (when Fable gives the book's page) sit below the line.
- The pulldown holds the book's other changes and a **Review** box: one row that grows as you type. **Post to Fable** opens the book's Fable page and pastes the review into Fable's review box (Chrome extension); elsewhere it copies the review and opens the page. Nothing is posted until you post it on Fable. Progress never repeats in the pulldown.
- **Past checkouts** sits right below the checkouts: Libby's loan history has no endpoint this tool uses, so Libby's automatic **Borrowed** tag stands in. Each title shows its Fable state (matched by title and author) and, when in Fable, a link. It scrolls after three rows. Without that tag, it says how to turn tagging on.
- **Pending sync** comes last. In Chrome it shows loans that the extension previously saw with pending sync and that have since left the Shelf. These saved records are reminders, and the extension only offers writes supported by the current provider data.

The **Sync** button compares both apps again; **Apply selected changes** applies the chosen ones. Loan end dates and Fable page links are display data: a change in them never makes a preview stale.

`SyncScreen` renders the shared Shelf and review controls; `useSync` coordinates settings, preview, approvals, apply, and errors over `LibraryApi`. The store retains the comparison across screen navigation. Preview requests include the current Rules title-match threshold. Preview and apply summaries stay in the shared `sync-state` helper. The extension uses the shared Lists screen and supplies its own Open in Libby action. Its compact connection controls show probe failures explicitly; an observed account change reloads cards immediately, even during the refresh cooldown.

Refresh and Sync controls keep their normal labels while temporarily disabled. Cooldown timers, tooltips, and countdown announcements are not displayed; request throttling still applies in the app and extension.

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

Verified shared IDs/ISBNs take precedence over exact normalized title-and-author work matching. When a loan's ISBN matches no Fable ISBN, sync checks it against public edition data (Open Library's editions of the loan's work, or Google Books if Open Library fails). If exactly one format-compatible Fable book carries an ISBN of another edition of that work, both share a verified work ID and match. Ambiguous or failed checks change nothing, and apply's stale-data check ignores these links. Only the loan's ISBN is sent. Sync keeps audiobook, ebook, and physical editions separate when the providers identify their formats. An unverified format needs an exact ISBN or a manual choice. Passage annotations require a verified compatible edition and location anchor even when the overall work matches.

When Libby omits the ISBN for a checkout, live Sync checks the exact title ID in its library catalog. Unmatched books are then looked up in Fable by title and available ISBN. Review shows compatible saved books and catalog editions that meet **Rules → Title match threshold**. An edition you choose can be added to Currently Reading after the loan has reading progress and you approve the change.

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
