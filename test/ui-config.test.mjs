import { expect, it } from "vitest";
import { resolve, SAFE_DEFAULTS } from "../ui/src/lib/config.ts";

it("keeps the last valid config when an override is invalid", () => {
  const previous = resolve({ dryRun: false, delayMs: 0 }).config;
  const resolved = resolve({ delayMs: -1 }, previous);

  expect(resolved.error).toMatch(/Invalid configuration/);
  expect(resolved.config).toBe(previous);
  expect(SAFE_DEFAULTS.dryRun).toBe(true);
});
