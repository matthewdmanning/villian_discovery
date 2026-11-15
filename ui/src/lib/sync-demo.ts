import { z } from "zod";
import type { BookSnapshot, SyncProvider } from "../../../src/sync.ts";
import {
  applySync,
  previewSync,
  type SyncAdapter,
  type SyncAdapters,
  type SyncApplyReport,
  type SyncApprovals,
  type SyncContext,
  type SyncJournal,
  type SyncOutcome,
  type SyncPlan,
  type SyncPreviewOptions,
} from "../../../src/sync-plan.ts";
import { DEMO_SYNC_SNAPSHOTS } from "./sync-demo-data.ts";
import { loadUserSyncSettings, saveUserSyncSettings } from "./sync-settings.ts";

const context: SyncContext = { userId: "demo-user", connectionId: "demo-libby-and-fable" };
const snapshots: Record<SyncProvider, BookSnapshot[]> = structuredClone(DEMO_SYNC_SNAPSHOTS);
const plans = new Map<string, SyncPlan>();
// ponytail: demo-only memory journal; production requires a durable user-scoped journal and cross-process locking.
const entries = new Map<string, SyncOutcome[]>();
const locks = new Set<string>();

/** Use this function to address only the current demo account's plan outcomes. */
function journalKey(owner: SyncContext, planId: string): string {
  return JSON.stringify([owner.userId, owner.connectionId, planId]);
}

const journal: SyncJournal = {
  /** Use this method to exclude concurrent demo writes and settings changes for the same user. */
  async withLock<T>(owner: SyncContext, action: () => Promise<T>): Promise<T> {
    if (locks.has(owner.userId)) throw new Error("A sync is already applying for this user");
    locks.add(owner.userId);
    try {
      return await action();
    } finally {
      locks.delete(owner.userId);
    }
  },
  /** Use this method to read only this user's retained outcomes for a particular plan. */
  async read(owner, planId) {
    return structuredClone(entries.get(journalKey(owner, planId)) ?? []);
  },
  /** Use this method to record demo outcomes before a write and after verification. */
  async write(owner, planId, outcomes) {
    entries.set(journalKey(owner, planId), structuredClone(outcomes));
  },
};

/** Use this function to build a simulated provider; its writes replace guarded in-memory fields and never call a network service. */
function demoAdapter(provider: "libby" | "fable"): SyncAdapter {
  const fields =
    provider === "libby"
      ? ["readingProgress", "checkedOut", "finished", "rating", "notes", "shelves"]
      : ["readingProgress", "readingStatus", "rating", "notes", "shelves"];
  const writableFields = provider === "libby" ? ["rating", "notes", "shelves"] : fields;
  return {
    verified: true,
    fields,
    writableFields,
    async read(owner) {
      if (journalKey(owner, "") !== journalKey(context, "")) throw new Error("Demo account changed");
      return structuredClone(snapshots[provider]);
    },
    async write(owner, operation, assertCurrent) {
      await assertCurrent();
      if (
        journalKey(owner, "") !== journalKey(context, "") ||
        operation.target !== provider ||
        !writableFields.includes(operation.field)
      )
        throw new Error("Unsupported demo write");
      const book = snapshots[provider].find((candidate) => candidate.bookId === operation.bookId);
      if (!book) throw new Error("Destination book no longer exists");
      const fields = book.fields;
      if (JSON.stringify(fields[operation.field]) !== JSON.stringify(operation.before))
        throw new Error("Destination changed; preview again");
      fields[operation.field] = {
        value: structuredClone(operation.after),
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

const adapters: SyncAdapters = { libby: demoAdapter("libby"), fable: demoAdapter("fable") };

export const demoSyncApi = {
  /** Use this method to load the current demo user's settings over the shipped fallback file. */
  async getSyncSettings() {
    return loadUserSyncSettings(context.userId);
  },
  /** Use this method to save validated user overrides and invalidate prior plans whose settings changed. */
  async saveSyncSettings(input: unknown) {
    return journal.withLock(context, async () => {
      const settings = saveUserSyncSettings(context.userId, input);
      plans.clear();
      return settings;
    });
  },
  /** Use this method to retain a trusted preview server-side in the simulated account boundary; the UI receives a separate copy. */
  async previewSync(options: SyncPreviewOptions = {}): Promise<SyncPlan> {
    const key = `libby-shelf.sync.matches.${encodeURIComponent(context.userId)}.${encodeURIComponent(context.connectionId)}`;
    let stored: Record<string, string> = {};
    try {
      stored = z.record(z.string(), z.string().min(1)).parse(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {
      stored = {};
    }
    // Explicit matches replace the stored set so "Leave unmatched" can remove one; vanished books are pruned.
    const matches = Object.fromEntries(
      Object.entries(options.matches ?? stored).filter(
        ([libbyId, fableId]) =>
          snapshots.libby.some((book) => book.bookId === libbyId) &&
          snapshots.fable.some((book) => book.bookId === fableId),
      ),
    );
    const plan = await previewSync({
      context,
      settings: loadUserSyncSettings(context.userId),
      adapters,
      options: { ...options, matches },
    });
    try {
      localStorage.setItem(key, JSON.stringify(matches));
    } catch {
      // Storage is a convenience; the preview stays valid without it.
    }
    plans.set(plan.id, plan);
    return structuredClone(plan);
  },
  /** Use this method to apply only a retained demo plan by ID; arbitrary client plan payloads are never accepted. */
  async applySync(planId: string, approvals: SyncApprovals): Promise<SyncApplyReport> {
    const plan = plans.get(planId);
    if (!plan) throw new Error("Preview is unavailable or settings changed; preview again");
    return applySync({
      context,
      settings: loadUserSyncSettings(context.userId),
      readSettings: async () => loadUserSyncSettings(context.userId),
      plan,
      adapters,
      journal,
      approvals,
    });
  },
};
