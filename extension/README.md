# Libby Shelf Chrome extension

Build with `npm install` and `npm run build` in this directory. In `chrome://extensions`, enable Developer mode and load `extension/dist` as an unpacked extension. After rebuilding, reload it on that page.

Keep a signed-in Libby tab open. Open Libby Shelf from Chrome's Extensions menu and choose **Open app** to use the full interface with the extension's connections. Search and run use the signed-in Libby account; run follows the app's dry-run setting and can borrow or place holds when dry run is disabled.

The **Lists** tab shows tagged titles from Libby. Choose tags under Includes and Exclude to filter the list, and use Refresh to reload it.

The **Shelf** tab lists current checkouts and holds. Returned history is unavailable until a reliable Libby source is verified.
Audiobook narrator credits appear in the side panel, Shelf, and expanded Search results when available from Libby or the OverDrive catalog.
