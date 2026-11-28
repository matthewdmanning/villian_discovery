# Changelog

## Unreleased

- Added the Chrome extension with a full library view, an audiobook side panel, and an account-specific Libby Tags cache.
- Added Shelf tabs for checked-out, held, and returned titles, and kept the experimental Libby Tags viewer in the web app.
- Combined Search and Tags into one Search screen with a tag picker, `title:`/`author:` fields, and typo-tolerant title and author matching.
- Added public book metadata (Open Library, then Google Books) behind one interface to resolve and check ISBNs from Libby and Fable: Search shows what an ISBN resolves to, and sync matches a loan to the Fable copy of the same work in another edition.
- Made Sync the first screen and reworked its Shelf: author, narrators and days left under each title, Open in Fable, a review box with Post to Fable, past checkouts from Libby's Borrowed tag, yellow only for unsynced books, and a **Sync** button in place of Preview changes. Phones wrap a book's fields under its title instead of scrolling sideways.
- Simplified navigation (#33): removed the Connect Libby screen and its `/api/login` routes (use `libby-shelf login`), hid Book list, deprecated Rules, and moved Library cards into Sync's Settings tab. Audiobook player tags accept emoji.
- Shared sync preview and apply behavior between the web app and extension. Sync can add missing Libby loans to Fable's Currently Reading list and shows which changes succeeded or failed.

### Commits

- `bac6f5f` Add the experimental web Tags screen.
- `7c72417` Read Libby Shelf activity and audiobook progress.
- `1878bcd` Add the Chrome extension and share library sync.
- `25ad905` Build the Chrome extension in CI.
