import { z } from "zod";
import shippedFallbacks from "./sync.fallbacks.json" with { type: "json" };

export const SyncSettingsSchema = z
  .object({
    version: z.literal(1),
    metadataScope: z.enum(["all-shared", "lists-tags", "lists-tags-notes"]),
    matching: z.enum(["work", "identifiers"]),
    progress: z.enum(["furthest", "latest", "choose"]),
    conflicts: z.enum(["ask", "libby", "fable"]),
    removals: z.enum(["none", "fields-memberships", "all-supported"]),
    showNonConflicting: z.enum(["no", "yes"]),
    allowProgressDecrease: z.boolean(),
  })
  .strict();

export type SyncSettings = z.infer<typeof SyncSettingsSchema>;
export type SyncSettingsInput = Partial<SyncSettings>;

export const SYNC_FALLBACKS: Readonly<SyncSettings> = Object.freeze(SyncSettingsSchema.parse(shippedFallbacks));

/** Use this function to resolve optional per-user sync settings against complete validated fallbacks. */
export function resolveSyncSettings(user: unknown = {}, fallbacks: unknown = SYNC_FALLBACKS): SyncSettings {
  const validatedFallbacks = SyncSettingsSchema.parse(fallbacks);
  const validatedUser = SyncSettingsSchema.partial().strict().parse(user);
  return SyncSettingsSchema.parse({ ...validatedFallbacks, ...validatedUser });
}
