#!/bin/sh
# Double-click to start libby-shelf on macOS (or run it on Linux). Installs what is missing, then opens the app in your browser.
cd "$(dirname "$0")" || exit 1
failed() {
  echo "libby-shelf could not start. Read the message above."
  printf "Press Return to close. "
  read -r _
  exit 1
}
if ! command -v node >/dev/null 2>&1; then
  echo "libby-shelf needs Node.js. The download page opens now."
  echo "Install Node.js, then double-click this file again."
  (open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1
  failed
fi
[ -d node_modules ] || npm ci || failed
[ -d ui/node_modules ] || npm ci --prefix ui || failed
npm run live && exit 0
# The app stopped. Start it again; the open page reconnects without a new tab. Closing this window stops it.
export LIBBY_SHELF_RESTART=1
until sleep 2 && node dist/sync-server.js; do :; done
