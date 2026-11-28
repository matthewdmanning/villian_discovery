# Libby Shelf Chrome extension

Build with `npm install` and `npm run build` in this directory. In `chrome://extensions`, enable Developer mode and load `extension/dist` as an unpacked extension. After rebuilding, reload it on that page.

Keep a signed-in Libby tab open. Open Libby Shelf from Chrome's Extensions menu and choose **Open app** to use the full interface with the extension's connections. Search and run use the signed-in Libby account; run follows the app's dry-run setting and can borrow or place holds when dry run is disabled.

The **Search** tab shows tagged titles from Libby. Add tags under Includes and Exclude to filter the list, and use Refresh to reload it. Text searches the library catalog, or narrows the tagged list when tags are selected. An ISBN resolves to its title and author through Open Library or Google Books (keyless), and sync checks whether a loan and a Fable book are editions of the same work. That is why the extension can reach `openlibrary.org` and `books.googleapis.com`; these services receive only the ISBN being checked.

The side panel opens on the Sync **Shelf** tab. It lists current checkouts with their Libby links and highlights books that need sync. Previously observed loans with pending sync appear below current checkouts after they leave the Shelf. The full app also shows holds. Complete returned history is unavailable.
Audiobook narrator credits appear on the Shelf and in expanded Search results when available from Libby or the OverDrive catalog.
