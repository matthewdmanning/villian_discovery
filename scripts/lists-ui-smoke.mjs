import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Phone-width checks for tag filtering on the Search screen. Run against `npm run dev --prefix ui`.
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
  // Saved searches sit behind a feature flag, which is read from storage only.
  await page.addInitScript(() => localStorage.setItem("libby-shelf.feature.multiquery", "true"));
  await page.goto(process.env.UI_URL ?? "http://127.0.0.1:5173");
  const noSideScroll = async () =>
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const addTag = async (name) => {
    await page.getByRole("button", { name: "Add tag to Includes" }).first().click();
    const picker = page.getByRole("dialog", { name: "Add tag to Includes" });
    await picker.getByRole("button", { name, exact: true }).click();
    // A selected tag leaves the picker, so the same tag cannot be chosen twice.
    assert.equal(await picker.getByRole("button", { name, exact: true }).count(), 0);
    await picker.getByRole("button", { name: "Done", exact: true }).click();
  };

  await page.getByRole("button", { name: "Search", exact: true }).first().click();
  await page.getByText("Piranesi", { exact: true }).waitFor();
  await noSideScroll();
  await addTag("Want to read");
  assert.equal(await page.getByText("Kindred", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Add query" }).click();
  assert.equal(await page.getByRole("button", { name: "Edit query" }).count(), 1);
  await addTag("Want to read");
  await page.getByRole("button", { name: "Add query" }).click();
  await page.getByText("Identical to an existing search", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit query" }).click();
  await page.getByRole("button", { name: "Cancel editing query" }).click();
  await page.getByText("Piranesi", { exact: true }).click();
  await page.getByText("Checked out / Total").waitFor();
  await noSideScroll();
  assert.deepEqual(errors, []);
  console.log("Search tag checks passed: tag picker, saved searches, duplicate detection, details and phone layout.");
} finally {
  await browser.close();
}
