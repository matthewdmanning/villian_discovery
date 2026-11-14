import { describe, expect, it } from "vitest";
import { resolveSyncSettings, SYNC_FALLBACKS, SyncSettingsSchema } from "../src/sync-config.js";

describe("sync settings", () => {
  it("ships validated fallbacks and inherits omitted fields", () => {
    expect(SYNC_FALLBACKS).toEqual({
      version: 1,
      metadataScope: "all-shared",
      matching: "work",
      progress: "furthest",
      conflicts: "ask",
      removals: "none",
      publicCopy: "review",
    });
    expect(resolveSyncSettings({ progress: "latest", publicCopy: "block" })).toEqual({
      ...SYNC_FALLBACKS,
      progress: "latest",
      publicCopy: "block",
    });
  });

  it("rejects invalid users, unknown keys, nulls, and incomplete fallbacks", () => {
    expect(() => resolveSyncSettings({ progress: "never" })).toThrow();
    expect(() => resolveSyncSettings({ extra: "value" })).toThrow();
    expect(() => resolveSyncSettings(null)).toThrow();
    expect(() => resolveSyncSettings({}, { ...SYNC_FALLBACKS, publicCopy: undefined })).toThrow();
  });

  it("has no embedded defaults", () => {
    expect(SyncSettingsSchema.safeParse({}).success).toBe(false);
    expect(SyncSettingsSchema.safeParse({ ...SYNC_FALLBACKS, extra: true }).success).toBe(false);
  });
});
