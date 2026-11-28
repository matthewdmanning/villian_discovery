import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Run against `npm run dev --prefix ui`; requires installed Chrome (or BROWSER_CHANNEL=msedge).
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(process.env.UI_URL ?? "http://127.0.0.1:5173");
  const nav = page.locator("aside");
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  const cardRows = page.locator("table tbody tr");
  await cardRows.nth(1).waitFor();
  const priorityColumn = (await page.locator("table thead th").allTextContents()).indexOf("Priority");
  assert.notEqual(priorityColumn, -1);
  assert.equal((await cardRows.first().locator("td").nth(priorityColumn).textContent()).trim(), "2");
  assert.equal((await cardRows.last().locator("td").nth(priorityColumn).textContent()).trim(), "1");
  assert.equal(await page.getByRole("columnheader", { name: "Library key", exact: true }).count(), 0);
  assert.match(await cardRows.first().textContent(), /Main/);
  await page.getByRole("button", { name: "Move Main down", exact: true }).click();
  assert.match(await cardRows.first().textContent(), /Branch/);
  await page.getByRole("checkbox", { name: "Use Branch", exact: true }).uncheck();
  assert.match(await cardRows.first().textContent(), /Main/);
  assert.match(await cardRows.last().textContent(), /Branch/);
  assert.equal(await cardRows.last().getAttribute("draggable"), "false");
  assert.equal(await page.getByRole("button", { name: "Move Branch up", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Move Branch down", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Use Main", exact: true }).isDisabled(), true);
  await cardRows.first().dragTo(cardRows.last());
  assert.match(await cardRows.first().textContent(), /Main/);
  await page.getByRole("checkbox", { name: "Use Branch", exact: true }).check();
  assert.match(await cardRows.first().textContent(), /Branch/);
  await cardRows.first().dragTo(cardRows.last());
  assert.match(await cardRows.first().textContent(), /Main/);
  await page.getByRole("button", { name: "Move Main down", exact: true }).click();
  await page.reload();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  assert.match(await cardRows.first().textContent(), /Branch/);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCards = page.locator("main ul > li");
  assert.match(await mobileCards.first().textContent(), /Branch/);
  await page.getByRole("button", { name: "Move Main up", exact: true }).click();
  assert.match(await mobileCards.first().textContent(), /Main/);
  await page.getByRole("checkbox", { name: "Use Main", exact: true }).uncheck();
  assert.match(await mobileCards.last().textContent(), /Main/);
  assert.equal(await mobileCards.last().getAttribute("draggable"), "false");
  assert.equal(await page.getByRole("button", { name: "Move Main up", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "Use Main", exact: true }).check();
  await page.setViewportSize({ width: 1280, height: 900 });
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  const input = page.locator("#books-text");
  const duplicate = "Dune by Frank Herbert\nDune by Frank Herbert";
  await input.fill(duplicate);
  const actions = page.locator("table select[aria-label=action]");
  await actions.nth(0).selectOption("borrow");
  await actions.nth(1).selectOption("hold");
  assert.equal(await actions.nth(0).inputValue(), "borrow");
  assert.equal(await actions.nth(1).inputValue(), "hold");
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  assert.equal(await input.inputValue(), duplicate);
  assert.equal(await actions.nth(0).inputValue(), "borrow");
  assert.equal(await actions.nth(1).inputValue(), "hold");

  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  const limit = page.getByText("Max loans per run", { exact: true }).locator("..").locator("input");
  await limit.fill("-1");
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Preview results", exact: true }).isDisabled(), true);
  await page.getByRole("alert").waitFor();
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("");
  await nav.getByRole("button", { name: "Book list", exact: true }).click();

  await page.evaluate(async () => {
    const loaded = performance
      .getEntriesByType("resource")
      .findLast((entry) => new URL(entry.name).pathname === "/src/lib/api.ts");
    const { demoApi } = await import(loaded?.name ?? "/src/lib/api.ts");
    window.testDemoApi = demoApi;
    window.originalRun = demoApi.run;
    demoApi.run = async () => {
      throw new Error("Injected run failure");
    };
  });
  await page.getByRole("button", { name: "Preview results", exact: true }).click();
  await page.getByText("Run failed: Injected run failure", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testDemoApi.run = window.originalRun;
  });
  await page.getByRole("button", { name: "Preview results", exact: true }).click();
  await page.getByRole("heading", { name: "Plan & results", exact: true }).waitFor();
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("-1");
  await nav.getByRole("button", { name: "Search", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Run for real", exact: true }).isDisabled(), true);
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("");
  await nav.getByRole("button", { name: "Search", exact: true }).click();
  await page.evaluate(() => {
    window.testDemoApi.run = async () => {
      throw new Error("Injected real run failure");
    };
  });
  await page.getByRole("button", { name: "Run for real", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Run failed: Injected real run failure", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testDemoApi.status = async () => {
      throw new Error("Injected status failure");
    };
  });
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await page.getByText("Injected status failure", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  await input.fill("Another book");
  assert.equal(await actions.first().inputValue(), "", "new input must clear old row overrides");

  const chooseMethod = (name) => page.getByRole("radio", { name, exact: true }).check();
  await input.fill('{"books":[{"title":"Dune","author":"Frank Herbert"}]}');
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.locator("tbody tr td").first().textContent(), "Dune");

  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  const mainCard = page.getByRole("checkbox", { name: "Use Main", exact: true });
  const branchCard = page.getByRole("checkbox", { name: "Use Branch", exact: true });
  await branchCard.uncheck();
  assert.equal(await mainCard.isChecked(), true);
  assert.equal(await mainCard.isDisabled(), true, "the final selected card must stay enabled for use");
  await branchCard.check();

  await page.evaluate(async () => {
    const { demoApi } = await import("/src/lib/api.ts");
    window.originalCards = demoApi.cards;
    demoApi.cards = async (tokenFile) => {
      window.cardsTokenFile = tokenFile;
      if (!window.cardsAfterLogin) throw new Error("Sign in to load cards");
      return [
        { cardId: "a", advantageKey: "lib1", cardName: "One" },
        { cardId: "b", advantageKey: "lib1", cardName: "Two" },
      ];
    };
    demoApi.status = async () => ({ connected: false });
    demoApi.login = async (_tokenFile, options) => {
      options.onCode("12345678");
      await new Promise((resolve, reject) => {
        window.approvePairing = resolve;
        options.signal?.addEventListener(
          "abort",
          () => {
            window.pairingCancelled = true;
            reject(options.signal.reason);
          },
          { once: true },
        );
      });
      window.cardsAfterLogin = true;
    };
  });
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByRole("button", { name: "Refresh cards", exact: true }).click();
  await page.getByText("Could not load cards: Sign in to load cards", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Could not load cards: Sign in to load cards", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await chooseMethod("phone code");
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  assert.equal(await page.evaluate(() => window.pairingCancelled), true);
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await page.getByText("Not connected to Libby", { exact: true }).waitFor();
  await chooseMethod("phone code");
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await page.evaluate(() => window.approvePairing());
  await page.getByText("12345678", { exact: true }).waitFor({ state: "hidden" });
  await page.getByText("Connected to Libby", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByRole("checkbox", { name: "Use One", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Move One up", exact: true }).count(), 1);

  await page.evaluate(async () => {
    (await import("/src/lib/api.ts")).demoApi.cards = async () => [];
  });
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await chooseMethod("phone code");
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await page.evaluate(() => window.approvePairing());
  await page.getByText("12345678", { exact: true }).waitFor({ state: "hidden" });
  await page.getByText("Connected to Libby", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByText("No library cards found.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Refresh cards", exact: true }).waitFor();
  assert.deepEqual(errors, [], "browser errors or duplicate React keys");

  const syncButton = () => page.locator("main").getByRole("button", { name: "Sync", exact: true });
  await nav.getByRole("button", { name: "Sync", exact: true }).click();
  // The comparison runs on its own when Sync opens.
  await page.getByRole("status").filter({ hasText: "Last compared" }).waitFor();
  // Right after a preview, Sync can run again: repeated reads are throttled where they are made.
  const previewAgain = syncButton();
  assert.equal(await previewAgain.isDisabled(), false);
  assert.equal(await previewAgain.textContent(), "Sync");
  assert.equal(await previewAgain.getAttribute("title"), null);
  const openTab = (name) => page.getByRole("tab", { name, exact: true }).click();
  const bookItem = (book) =>
    page
      .locator('main section:not([aria-label="Past checkouts"]) li')
      .filter({ has: page.locator("span.truncate", { hasText: book }) });
  const squash = (text) => text.replace(/\s+/g, " ").trim();
  const bookLine = async (book) => {
    const summary = bookItem(book).locator("summary");
    return squash(await ((await summary.count()) ? summary : bookItem(book)).textContent()).replace(
      /\s*\(needs sync\)/g,
      "",
    );
  };
  await openTab("Library");
  await bookItem("Piranesi").waitFor();
  assert.equal(await page.locator("table").count(), 0);
  assert.doesNotMatch(
    await page.locator("[role=tabpanel][aria-label=Library]").textContent(),
    /Checked out:|Finished:|→/,
  );
  assert.match(await page.getByRole("region", { name: "Checked out" }).textContent(), /Dune.*Piranesi/);
  assert.match(await bookLine("Piranesi"), /^Piranesi ?65%.*In Progress$/);
  assert.equal(await bookItem("Piranesi").getByRole("img", { name: "5 of 5 stars", exact: true }).count(), 1);
  assert.match(
    await bookItem("Piranesi").getByText("In Progress", { exact: true }).getAttribute("class"),
    /text-status-progress/,
  );
  assert.match(squash(await bookItem("Piranesi").textContent()), /shelves: ?Libby: Favorites ?or ?Fable: Book club/);
  assert.equal(await page.locator("svg.lucide-triangle-alert").count(), 0);
  assert.match(await bookLine("Dune"), /^Dune ?100%.*Finished$/);
  await openTab("Shelf");
  assert.match(
    await bookLine("Dune"),
    /^Dune ?Frank Herbert · Narrated by Scott Brick · 9 days left ?100% ?\+80%.*Finished$/,
  );
  // Dune's pulldown holds only its review box: progress stays on the line.
  await bookItem("Dune").locator("summary").click();
  assert.equal(await bookItem("Dune").getByRole("textbox", { name: "Review of Dune", exact: true }).count(), 1);
  assert.doesNotMatch(squash(await bookItem("Dune").locator("details > ul").textContent()), /progress/i);
  await bookItem("Dune").locator("summary").click();
  const pastCheckouts = page.getByRole("region", { name: "Past checkouts" });
  await pastCheckouts.getByText("Kindred", { exact: true }).waitFor();
  assert.match(squash(await pastCheckouts.textContent()), /Piranesi.*In Progress.*Kindred.*Not in Fable/);
  assert.equal(await page.locator("svg.lucide-triangle-alert").count(), 0);
  const duneNotes = page.getByRole("checkbox", { name: "Apply notes to Libby for Dune", exact: true });
  assert.equal(await duneNotes.count(), 0);
  assert.equal(await page.getByText("non-conflicting changes hidden", { exact: false }).count(), 0);
  const showAll = page.getByLabel("Show non-conflicting changes", { exact: true });
  await openTab("Settings");
  await page.getByText("Advanced", { exact: true }).click();
  assert.equal(await page.getByLabel("Allow decrease in progress", { exact: true }).isChecked(), false);
  await showAll.selectOption("yes");
  await openTab("Shelf");
  await syncButton().click();
  await bookItem("Dune").locator("summary").click();
  await duneNotes.waitFor();
  await openTab("Settings");
  await showAll.selectOption("no");
  await openTab("Shelf");
  await syncButton().click();
  await page.getByRole("button", { name: "Apply demo changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Applied" }).waitFor();
  await syncButton().click();
  assert.equal(await page.getByRole("button", { name: "Apply demo changes", exact: true }).isDisabled(), true);
  await openTab("Library");
  assert.match(await bookLine("Piranesi"), /^Piranesi ?65%/);
  await openTab("Settings");
  await page.getByLabel("Removals", { exact: true }).selectOption("fields-memberships");
  await openTab("Shelf");
  await syncButton().click();
  await openTab("Library");
  await page.getByRole("button", { name: "Use Libby shelves for Piranesi", exact: true }).click();
  await openTab("Shelf");
  const removal = page.getByRole("checkbox", { name: "Apply shelves to Fable for Piranesi", exact: true });
  await removal.check();
  assert.equal(await page.getByRole("button", { name: "Apply demo changes", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox", { name: "Confirm removal of shelves on Fable for Piranesi", exact: true }).check();
  assert.equal(await page.getByRole("button", { name: "Apply demo changes", exact: true }).isDisabled(), false);
  await page.getByRole("button", { name: "Apply demo changes", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Applied" }).waitFor();
  await syncButton().click();
  await openTab("Library");
  await bookItem("Piranesi").waitFor();
  assert.match(squash(await bookItem("Piranesi").textContent()), /shelves: ?Favorites/);
  await openTab("Settings");
  for (const removed of ["Libby progress across editions", "Book matching"])
    assert.equal(await page.getByLabel(removed, { exact: true }).count(), 0);
  const advanced = page.locator("details").filter({ has: page.getByText("Advanced", { exact: true }) });
  assert.equal(await advanced.getByLabel("Shared metadata", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click();
  assert.equal(await page.getByLabel("Removals", { exact: true }).inputValue(), "none");
  await openTab("Shelf");
  await syncButton().click();
  const comparisonStatus = await page.getByRole("status").filter({ hasText: "Last compared" }).textContent();
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  await nav.getByRole("button", { name: "Sync", exact: true }).click();
  assert.equal(await page.getByRole("status").filter({ hasText: "Last compared" }).textContent(), comparisonStatus);
  await page.evaluate(() => {
    window.testDemoApi.previewSync = async () => {
      throw new Error("Injected sync failure");
    };
  });
  await syncButton().click();
  await page.getByRole("alert").filter({ hasText: "Injected sync failure" }).waitFor();
  assert.equal(await page.getByRole("status").filter({ hasText: "Last compared" }).textContent(), comparisonStatus);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('nav[aria-label="Screens"]').last().getByRole("button", { name: "Books", exact: true }).click();
  await page.locator('nav[aria-label="Screens"]').last().getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("heading", { name: "Sync", exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  // Phone audiobook bookmarks: full-screen sheet, draft until Save, back asks before discarding.
  await page.locator('nav[aria-label="Screens"]').last().getByRole("button", { name: "Player", exact: true }).click();
  const openSheet = () => page.getByRole("button", { name: /^Bookmarks \(/ }).click();
  const sheet = page.getByRole("dialog", { name: "Bookmarks", exact: true });
  const discard = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await openSheet();
  await sheet.getByRole("button", { name: "Add bookmark", exact: true }).click();
  await sheet.getByPlaceholder("Add a note…").fill("Draft note");
  await page.goBack();
  await discard.waitFor();
  await discard.getByRole("button", { name: "Discard", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "Bookmarks (0)", exact: true }).count(), 1);
  await openSheet();
  await sheet.getByRole("button", { name: "Add bookmark", exact: true }).click();
  await sheet.getByPlaceholder("Add a note…").fill("Saved note");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "Bookmarks (1)", exact: true }).count(), 1);
  await openSheet();
  assert.equal(await sheet.getByPlaceholder("Add a note…").inputValue(), "Saved note");
  await sheet.getByRole("button", { name: "Back to player", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  assert.deepEqual(errors, [], "browser errors or duplicate React keys");
  console.log(
    "UI regression checks passed: card priority, drafts, run/status errors, sync precedence, conflicts, mobile navigation, and phone bookmark sheet.",
  );
} finally {
  await browser.close();
}
