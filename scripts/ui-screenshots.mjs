import { mkdir, readdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

// Captures every visible screen and its key states from demo data into docs/screenshots.
// Run against `npm run dev --prefix ui`; same browser settings as `npm run test:ui`.
const OUT = new URL("../docs/screenshots/", import.meta.url);
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

// Sample Libby shelf: the demo API has no shelf, so the populated Shelf state uses this.
const SAMPLE_SHELF = {
  checkedOut: {
    status: "available",
    items: [
      {
        id: "1",
        cardId: "1001",
        cardName: "Main",
        title: "Dune",
        author: "Frank Herbert",
        mediaType: "audiobook",
        narrators: ["Scott Brick"],
      },
      { id: "2", cardId: "1002", cardName: "Branch", title: "Piranesi", author: "Susanna Clarke", mediaType: "ebook" },
    ],
  },
  holds: {
    status: "available",
    items: [
      {
        id: "3",
        cardId: "1001",
        cardName: "Main",
        title: "Kindred",
        author: "Octavia E. Butler",
        mediaType: "ebook",
        holdListPosition: 4,
      },
    ],
  },
  returned: { status: "unavailable", reason: "Returned history is not connected yet." },
};

const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }),
  headless: true,
});
const shots = [];
try {
  await mkdir(OUT, { recursive: true });
  for (const file of await readdir(OUT)) if (file.endsWith(".png")) await rm(new URL(file, OUT));
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_URL ?? "http://127.0.0.1:5173");

  const nav = () =>
    page.viewportSize().width < 1024 ? page.locator('nav[aria-label="Screens"]').last() : page.locator("aside");
  const go = (name) => nav().getByRole("button", { name, exact: true }).click();
  const tab = (name) => page.getByRole("tab", { name, exact: true }).click();
  const compared = () => page.getByRole("status").filter({ hasText: "Last compared" }).waitFor();
  const syncButton = () => page.locator("main").getByRole("button", { name: "Sync", exact: true });
  const shot = async (name, caption, { fullPage = true } = {}) => {
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname, fullPage, animations: "disabled" });
    shots.push([name, caption]);
  };
  const demoApi = async (fn, arg) =>
    page.evaluate(
      async ([source, value]) => {
        const loaded = performance
          .getEntriesByType("resource")
          .findLast((entry) => new URL(entry.name).pathname === "/src/lib/api.ts");
        const api = (await import(loaded?.name ?? "/src/lib/api.ts")).demoApi;
        window.originals ??= {};
        new Function("api", "value", "originals", source)(api, value, window.originals);
      },
      [fn, arg],
    );
  const item = (title) =>
    page
      .locator('main section:not([aria-label="Past checkouts"]) li')
      .filter({ has: page.locator("span.truncate", { hasText: title }) });

  // Sync
  await go("Sync");
  await compared();
  await page.getByRole("region", { name: "Past checkouts" }).getByText("Kindred", { exact: true }).waitFor();
  await shot("sync-shelf", "Sync › Shelf: loans with progress, days left, past checkouts");
  await item("Dune").locator("summary").click();
  await page.getByRole("textbox", { name: "Review of Dune", exact: true }).fill("A desert epic that rewards patience.");
  await shot("sync-shelf-review", "Sync › Shelf: a loan opened, with its Fable review box");
  await item("Dune").locator("summary").click();
  await tab("Library");
  await item("Piranesi").waitFor();
  await shot("sync-library", "Sync › Library: every compared book, Libby and Fable side by side");
  await tab("Settings");
  await page.getByText("Advanced", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Use Main", exact: true }).waitFor();
  await shot("sync-settings", "Sync › Settings: sync settings and Library cards with priority");

  await page.getByLabel("Removals", { exact: true }).selectOption("fields-memberships");
  await tab("Shelf");
  await syncButton().click();
  await compared();
  await tab("Library");
  await page.getByRole("button", { name: "Use Libby shelves for Piranesi", exact: true }).click();
  await tab("Shelf");
  await page.getByRole("checkbox", { name: "Apply shelves to Fable for Piranesi", exact: true }).check();
  await page.getByRole("checkbox", { name: "Confirm removal of shelves on Fable for Piranesi", exact: true }).check();
  await item("Piranesi").scrollIntoViewIfNeeded();
  await shot("sync-removal-review", "Sync › Shelf: a removal selected and confirmed before Apply");
  await page.getByRole("button", { name: "Apply demo changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Applied" }).waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  await shot("sync-applied", "Sync: result after Apply", { fullPage: false });
  await tab("Settings");
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click();
  await tab("Shelf");

  await demoApi(
    "originals.previewSync = api.previewSync; api.previewSync = async () => { throw new Error('Fable did not answer'); };",
  );
  await syncButton().click();
  await page.getByRole("alert").filter({ hasText: "Fable did not answer" }).waitFor();
  await shot("sync-error", "Sync: a failed comparison keeps the previous result", { fullPage: false });
  await demoApi("api.previewSync = originals.previewSync;");
  // A successful comparison clears the error before the next shots.
  await syncButton().click();
  await page.getByRole("alert").filter({ hasText: "Fable did not answer" }).waitFor({ state: "detached" });
  await compared();

  await demoApi("originals.cards = api.cards; api.cards = async () => { throw new Error('Libby is not signed in'); };");
  await tab("Settings");
  await page.getByRole("button", { name: "Refresh cards", exact: true }).click();
  await page.getByText("Could not load cards: Libby is not signed in", { exact: true }).waitFor();
  await shot("sync-cards-error", "Sync › Settings: cards failed to load, with Retry");
  await demoApi("api.cards = async () => [];");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("No library cards found.", { exact: false }).waitFor();
  await shot("sync-cards-empty", "Sync › Settings: no library cards yet");
  await demoApi("api.cards = originals.cards;");
  await page.getByRole("button", { name: "Refresh cards", exact: true }).click();
  await page.getByRole("checkbox", { name: "Use Main", exact: true }).waitFor();
  await tab("Shelf");

  // Shelf
  await go("Shelf");
  await page.getByText("Shelf data is unavailable", { exact: false }).first().waitFor();
  await shot("shelf-demo", "Shelf: demo mode has no Libby shelf");
  await demoApi("originals.shelf = api.shelf; api.shelf = async () => value;", SAMPLE_SHELF);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Piranesi", { exact: true }).waitFor();
  await shot("shelf-checked-out", "Shelf › Checked out (sample data)");
  await page.getByRole("tab", { name: "Holds", exact: true }).click();
  await page.getByText("Kindred", { exact: true }).waitFor();
  await shot("shelf-holds", "Shelf › Holds (sample data)");
  await demoApi("api.shelf = originals.shelf;");

  // Search
  await go("Search");
  await page.getByText("Piranesi", { exact: true }).first().waitFor();
  await shot("search-tagged", "Search: tagged books when Search opens");
  await page.getByRole("button", { name: "Add tag to Includes" }).first().click();
  await page.getByRole("dialog", { name: "Add tag to Includes" }).waitFor();
  await shot("search-tag-picker", "Search: tag picker", { fullPage: false });
  const picker = page.getByRole("dialog", { name: "Add tag to Includes" });
  await picker.getByRole("button", { name: "Want to read", exact: true }).click();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await shot("search-tag-filter", "Search: filtered by the Want to read tag");
  await page.getByRole("button", { name: "Remove Want to read" }).click();
  await page.locator("main input[type=search]").fill("Dune by Frank Herbert");
  await page.locator("main").getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("option", { hasText: "Best match" }).first().waitFor({ state: "attached" });
  await page.getByText(/^Dune/).first().waitFor();
  await page.getByText("4 options", { exact: false }).first().click();
  await shot("search-catalog", "Search: catalog results, one title opened to its editions and libraries");

  // Audiobook player
  await go("Audiobook player");
  await page.getByRole("button", { name: "Add bookmark", exact: true }).first().click();
  await page.getByPlaceholder("Add a note…").first().fill("The keeper's first log entry.");
  for (const tag of ["🎵 Music", "⭐ Favorite"]) {
    // The menu stays open after a tag is added.
    if (!(await page.getByText("New Tag", { exact: true }).isVisible()))
      await page
        .getByRole("button", { name: /^Tags for bookmark/ })
        .first()
        .click();
    await page.getByText("New Tag", { exact: true }).click();
    await page.getByLabel("New tag name").fill(tag);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  }
  if (!(await page.getByText("New Tag", { exact: true }).isVisible()))
    await page
      .getByRole("button", { name: /^Tags for bookmark/ })
      .first()
      .click();
  await shot("player", "Audiobook player: bookmark with emoji tags and the tag menu", { fullPage: false });
  await page.keyboard.press("Escape");

  // Dark theme
  await go("Sync");
  await compared();
  await page.getByRole("button", { name: "Toggle theme" }).first().click();
  await page.getByRole("region", { name: "Past checkouts" }).getByText("Kindred", { exact: true }).waitFor();
  await shot("sync-shelf-dark", "Sync › Shelf in the dark theme");
  await page.getByRole("button", { name: "Toggle theme" }).first().click();

  // Phone
  await page.setViewportSize(PHONE);
  await go("Sync");
  await compared();
  await shot("phone-sync", "Phone: Sync with the bottom navigation", { fullPage: false });
  await tab("Settings");
  await page.getByRole("checkbox", { name: "Use Main", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Library cards", exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot("phone-sync-cards", "Phone: Library cards in Sync › Settings", { fullPage: false });
  await tab("Shelf");
  await go("Search");
  await page.getByText("Piranesi", { exact: true }).first().waitFor();
  await shot("phone-search", "Phone: Search", { fullPage: false });
  await go("Player");
  await page.getByRole("button", { name: /^Bookmarks \(/ }).waitFor();
  await shot("phone-player", "Phone: Audiobook player", { fullPage: false });
  await page.getByRole("button", { name: /^Bookmarks \(/ }).click();
  await page.getByRole("dialog", { name: "Bookmarks", exact: true }).waitFor();
  await shot("phone-bookmarks", "Phone: full-screen bookmarks sheet", { fullPage: false });

  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(shots.map(([name, caption]) => `| ${caption} | ![${caption}](${name}.png) |`).join("\n"));
} finally {
  await browser.close();
}
