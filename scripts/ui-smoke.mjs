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
  console.log("UI regression checks passed: draft, duplicate edits, invalid config, run/status errors.");
} finally {
  await browser.close();
}
