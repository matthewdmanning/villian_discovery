import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : { channel: process.env.BROWSER_CHANNEL ?? "chrome" }),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.UI_URL ?? "http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page.getByText("Piranesi", { exact: true }).waitFor();
  await page.getByRole("checkbox", { name: "multiquery" }).check();
  await page.getByRole("group", { name: "Includes" }).first().getByRole("checkbox", { name: "Want to read" }).check();
  assert.equal(await page.getByText("Kindred", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Add query" }).click();
  assert.equal(await page.getByRole("button", { name: "Edit query" }).count(), 1);
  await page.getByRole("group", { name: "Includes" }).first().getByRole("checkbox", { name: "Want to read" }).check();
  await page.getByRole("button", { name: "Add query" }).click();
  await page.getByText("Identical to an existing search", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit query" }).click();
  await page.getByRole("button", { name: "Cancel editing query" }).click();
  await page.getByText("Piranesi", { exact: true }).click();
  await page.getByText("Checked out / Total").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await page.getByRole("heading", { name: "Sync libraries" }).waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    "Lists UI checks passed: query selection, duplicate detection, editing, library details and phone layouts.",
  );
} finally {
  await browser.close();
}
