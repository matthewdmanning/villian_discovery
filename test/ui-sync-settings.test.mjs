import { afterEach, expect, it, vi } from "vitest";
import { SYNC_FALLBACKS } from "../src/sync-config.ts";
import { loadUserSyncSettings, saveUserSyncSettings } from "../ui/src/lib/sync-settings.ts";

afterEach(() => vi.unstubAllGlobals());

it("isolates saved settings by user and inherits missing values from the shipped file", () => {
  const values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  saveUserSyncSettings("one", { matching: "identifiers" });
  expect(loadUserSyncSettings("one")).toEqual({ ...SYNC_FALLBACKS, matching: "identifiers" });
  expect(loadUserSyncSettings("two")).toEqual(SYNC_FALLBACKS);
  expect(() => saveUserSyncSettings("one", { removals: "invalid" })).toThrow();
  expect(loadUserSyncSettings("one").matching).toBe("identifiers");
  saveUserSyncSettings("one", {});
  expect(loadUserSyncSettings("one")).toEqual(SYNC_FALLBACKS);
});

it("reports corrupt saved settings and rejects missing ownership", () => {
  vi.stubGlobal("localStorage", { getItem: () => "not JSON" });
  expect(() => loadUserSyncSettings("one")).toThrow();
  expect(() => loadUserSyncSettings(" ")).toThrow(/owner/);
});
