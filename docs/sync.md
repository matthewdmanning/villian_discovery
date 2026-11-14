# Library reconciliation

The Sync libraries tab compares deterministic demo snapshots and stores the result in the current tab's application state. It does not authenticate with, read, or write to Libby or Fable.

## Precedence

- `readingProgress` (percentage from 0 to 100), `checkedOut`, and `finished` always come from Libby, including zero and false. A missing Libby value is unknown, not a false value or permission to use Fable's value.
- Other fields use the newer **field edit** timestamp when both sources have different values. Compare instants, including timezone offsets, rather than date strings.
- Different values with missing timestamps or equal instants remain conflicts. Identical values need no timestamp to agree.
- A value present in only one source is retained, except for Fable-only authoritative fields. Explicit `null` means clearing an ordinary field; absence means unknown.

Conflicts remain unresolved and are excluded from chosen values. The UI displays both source values and edit times. A failed refresh keeps the previous successful comparison and reports the failure; it does not replace the result with a partial source response.

## Normalized provider input

`reconcileSnapshots(libby, fable)` accepts an array from each source:

```json
[
  {
    "bookId": "isbn:9781635575637",
    "title": "Piranesi",
    "fields": {
      "readingProgress": { "value": 45 },
      "checkedOut": { "value": true },
      "finished": { "value": false },
      "rating": { "value": 4, "updatedAt": "2026-11-13T10:00:00Z" }
    }
  }
]
```

`bookId` must already identify the same book across both sources. Provider-local IDs and similar titles are not sufficient to merge records. Duplicate IDs within either source are rejected. `title` labels the book; title edits to be reconciled belong in `fields.title` with their edit time.

Ordinary field values may be strings, finite numbers, booleans, null, or string arrays. Timestamps, when provided, must be valid ISO date-times with a timezone. Invalid status values, malformed input, and invalid timestamps are rejected before reconciliation. Progress and status fields have their specific numeric/boolean validation.

## Live integration gaps

The existing Libby client reads cards, loans, and holds from `chip/sync`. Loan membership can establish checked-out status, but the code does not yet map verified reading-progress, finished-history, or edit-timestamp fields. Libby's [Reading Journey](https://help.libbyapp.com/en-us/6228.htm) describes reading progress; a production adapter still needs a verified data mapping rather than guessed response fields.

The existing Fable integration reads list names and book identity metadata through the user's logged-in browser. Its normalized export drops other fields and has no verified field timestamps or write operations. Existing [Fable access rules](CONTEXT.md#fableco-api-discovery) continue to apply.

Before live sync can run, adapters must supply complete source snapshots, stable book identity mappings, and actual edit times. Whether sync only updates this app or writes changes back to the services must be decided separately; this preview implements neither provider writes nor an automatic background scheduler.
