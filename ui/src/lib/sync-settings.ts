import { resolveSyncSettings, type SyncSettings, SyncSettingsSchema } from "../../../src/sync-config.ts";

/** Use this function to address demo settings by their owning account; production storage remains a runtime decision. */
function settingsKey(owner: string): string {
  if (!owner.trim()) throw new Error("A settings owner is required");
  return `libby-shelf.sync.settings.${encodeURIComponent(owner)}`;
}

/** Use this function to load a demo user's overrides over shipped fallbacks; corrupt saved settings are reported rather than silently ignored. */
export function loadUserSyncSettings(owner: string): SyncSettings {
  return resolveSyncSettings(JSON.parse(localStorage.getItem(settingsKey(owner)) ?? "{}"));
}

/** Use this function to validate and save one demo user's overrides; invalid data never replaces the previous saved settings. */
export function saveUserSyncSettings(owner: string, input: unknown): SyncSettings {
  const overrides = SyncSettingsSchema.partial().strict().parse(input);
  const resolved = resolveSyncSettings(overrides);
  localStorage.setItem(settingsKey(owner), JSON.stringify(overrides));
  return resolved;
}
