# Changelog

## Unreleased

- Added the Chrome extension with a full library view, an audiobook side panel, and an account-specific Libby Tags cache.
- Added Shelf tabs for checked-out, held, and returned titles, and kept the experimental Libby Tags viewer in the web app.
- Combined Search and Tags into one Search screen with a tag picker, `title:`/`author:` fields, and typo-tolerant title and author matching.
- Added public book metadata (Open Library, then Google Books) behind one interface: Search shows what an ISBN resolves to, and a catalog miss retries with an ISBN's title and author or a corrected title spelling (`matching.bookMetadata`).
- Shared sync preview and apply behavior between the web app and extension. Sync can add missing Libby loans to Fable's Currently Reading list and shows which changes succeeded or failed.

### Commits

- `bac6f5f` Add the experimental web Tags screen.
- `7c72417` Read Libby Shelf activity and audiobook progress.
- `1878bcd` Add the Chrome extension and share library sync.
- `25ad905` Build the Chrome extension in CI.
