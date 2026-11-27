import { resolveSyncSettings, type SyncSettings, SyncSettingsSchema } from "./sync-config.js";
import {
  applySync,
  createMemoryJournal,
  previewSync,
  type SyncAdapters,
  type SyncApplyReport,
  type SyncContext,
  type SyncJournal,
  type SyncPlan,
  type SyncPreviewOptions,
} from "./sync-plan.js";

export type SyncOrchestrator = {
  getSettings(): Promise<SyncSettings>;
  saveSettings(input: unknown): Promise<SyncSettings>;
  previewSync(options?: SyncPreviewOptions): Promise<SyncPlan>;
  applySync(planId: string, approvals: unknown): Promise<SyncApplyReport>;
};

/** Use this function to keep preview and apply state shared while leaving storage and adapter creation to each host. */
export function createSyncOrchestrator(input: {
  context: SyncContext;
  adapters: () => Promise<SyncAdapters>;
  readSettings: () => Promise<unknown>;
  writeSettings: (settings: unknown) => Promise<void>;
  journal?: SyncJournal;
  onPreview?: (plan: SyncPlan, adapters: SyncAdapters) => Promise<void>;
  onApply?: (plan: SyncPlan, report: SyncApplyReport, adapters: SyncAdapters) => Promise<void>;
}): SyncOrchestrator {
  const journal = input.journal ?? createMemoryJournal();
  const plans = new Map<string, SyncPlan>();
  let matches: Record<string, string> = {};

  return {
    getSettings: async () => resolveSyncSettings(await input.readSettings()),
    saveSettings: async (settingsInput) =>
      journal.withLock(input.context, async () => {
        const overrides = SyncSettingsSchema.partial().strict().parse(settingsInput);
        await input.writeSettings(overrides);
        plans.clear();
        return resolveSyncSettings(overrides);
      }),
    previewSync: async (options = {}) => {
      const adapters = await input.adapters();
      const plan = await previewSync({
        context: input.context,
        settings: await input.readSettings(),
        adapters,
        options: { ...options, matches: options.matches ?? matches },
      });
      matches = plan.options.matches ?? {};
      plans.set(plan.id, plan);
      await input.onPreview?.(plan, adapters);
      return plan;
    },
    applySync: async (planId, approvals) => {
      const plan = plans.get(planId);
      if (!plan) throw new Error("Preview is unavailable or settings changed; preview again");
      const adapters = await input.adapters();
      const report = await applySync({
        context: input.context,
        settings: await input.readSettings(),
        readSettings: input.readSettings,
        plan,
        adapters,
        journal,
        approvals,
      });
      await input.onApply?.(plan, report, adapters);
      return report;
    },
  };
}
