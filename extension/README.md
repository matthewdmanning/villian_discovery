# Libby Shelf Chrome extension

Build with `npm install` and `npm run build` in this directory. In `chrome://extensions`, enable Developer mode and load `extension/dist` as an unpacked extension. After rebuilding, reload it on that page.

Keep a signed-in Libby tab open. Open Libby Shelf from Chrome's Extensions menu and choose **Open app** to use the full interface with the extension's connections. Search and run use the signed-in Libby account; run follows the app's dry-run setting and can borrow or place holds when dry run is disabled.

The **Tags** tab displays Libby tag names and descriptions and saves them in Chrome's local extension storage. Refresh updates the cache; a failed refresh leaves the displayed tags intact. Restoring cached tags requires verifying the current account's library cards, so they are not available when that verification fails. The Libby identity token is not saved in the tag cache.

The **Shelf** tab lists current checkouts and holds. Returned history is unavailable until a reliable Libby source is verified.
