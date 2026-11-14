import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Run against `npm run dev --prefix ui`; requires installed Chrome (or BROWSER_CHANNEL=msedge).
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  assert.deepEqual(errors, [], "browser errors or duplicate React keys");
  console.log("UI regression checks passed: card priority, draft, duplicate edits, invalid config, run/status errors.");
} finally {
  await browser.close();
}
