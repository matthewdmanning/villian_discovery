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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(process.env.UI_URL ?? "http://127.0.0.1:5173");
  const nav = page.locator("aside");
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
  assert.equal(await page.getByRole("button", { name: "Plan", exact: true }).isDisabled(), true);
  await page.getByRole("alert").waitFor();
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("");
  await nav.getByRole("button", { name: "Book list", exact: true }).click();

  await page.evaluate(async () => {
    const { demoApi } = await import("/src/lib/api.ts");
    window.originalRun = demoApi.run;
    demoApi.run = async () => {
      throw new Error("Injected run failure");
    };
  });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Run failed: Injected run failure", { exact: true }).waitFor();
  await page.evaluate(async () => {
    (await import("/src/lib/api.ts")).demoApi.run = window.originalRun;
  });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("heading", { name: "Plan & results", exact: true }).waitFor();
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("-1");
  await nav.getByRole("button", { name: "Plan & results", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Run for real", exact: true }).isDisabled(), true);
  await nav.getByRole("button", { name: "Rules", exact: true }).click();
  await limit.fill("");
  await nav.getByRole("button", { name: "Plan & results", exact: true }).click();
  await page.evaluate(async () => {
    const { demoApi } = await import("/src/lib/api.ts");
    demoApi.run = async () => {
      throw new Error("Injected real run failure");
    };
  });
  await page.getByRole("button", { name: "Run for real", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByText("Run failed: Injected real run failure", { exact: true }).waitFor();
  await page.evaluate(async () => {
    (await import("/src/lib/api.ts")).demoApi.status = async () => {
      throw new Error("Injected status failure");
    };
  });
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await page.getByText("Injected status failure", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Book list", exact: true }).click();
  await input.fill("Another book");
  assert.equal(await actions.first().inputValue(), "", "new input must clear old row overrides");

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
  await page.getByText("Advanced", { exact: true }).click();
  const tokenFile = page.getByRole("textbox");
  await tokenFile.fill("/tmp/demo-account.identity.json");
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByText("Could not load cards: Sign in to load cards", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByText("Could not load cards: Sign in to load cards", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => window.pairingCancelled), true);
  await page.getByText("Not connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await page.evaluate(() => window.approvePairing());
  await page.getByText("12345678", { exact: true }).waitFor({ state: "hidden" });
  await page.getByText("Connected", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByRole("checkbox", { name: "Use One", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Move lib1 up", exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.cardsTokenFile), "/tmp/demo-account.identity.json");

  await page.evaluate(async () => {
    (await import("/src/lib/api.ts")).demoApi.cards = async () => [];
  });
  await nav.getByRole("button", { name: "Connect Libby", exact: true }).click();
  await page.getByRole("button", { name: "Display setup code", exact: true }).click();
  await page.getByText("12345678", { exact: true }).waitFor();
  await page.evaluate(() => window.approvePairing());
  await page.getByText("12345678", { exact: true }).waitFor({ state: "hidden" });
  await page.getByText("Connected", { exact: true }).waitFor();
  await nav.getByRole("button", { name: "Library cards", exact: true }).click();
  await page.getByText("No library cards found.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Refresh cards", exact: true }).waitFor();
  assert.deepEqual(errors, [], "browser errors or duplicate React keys");
  console.log(
    "UI regression checks passed: drafts, JSON, limits, run/status errors, pairing, card refresh/error/empty states and library ordering.",
  );
} finally {
  await browser.close();
}
