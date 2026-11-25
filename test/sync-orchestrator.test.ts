import { describe, expect, it } from "vitest";
import type { BookSnapshot, SyncProvider } from "../src/sync.js";
import { createSyncOrchestrator } from "../src/sync-orchestrator.js";
import type { SyncAdapter, SyncApplyReport, SyncContext, SyncJournal, SyncOperation } from "../src/sync-plan.js";

const context: SyncContext = { userId: "user-1", connectionId: "connection-1" };

function adapter(provider: SyncProvider, state: BookSnapshot[]): SyncAdapter {
  return {
    verified: true,
    fields: ["note"],
    writableFields: ["note"],
    async read() {
      return structuredClone(state);
    },
    async write(_context, operation: SyncOperation, assertCurrent) {
      await assertCurrent();
      const book = state.find((candidate) => candidate.bookId === operation.bookId);
      if (!book) throw new Error(`Unknown ${provider} book`);
      book.fields[operation.field] = { value: operation.after, updatedAt: "2026-01-03T00:00:00Z" };
    },
  };
}

function journal() {
  const entries = new Map<string, SyncApplyReport["outcomes"]>();
  const result: SyncJournal & { locks: number } = {
    locks: 0,
    async withLock(_context, action) {
      result.locks += 1;
      return action();
    },
    async read(_context, planId) {
      return structuredClone(entries.get(planId) ?? []);
    },
    async write(_context, planId, outcomes) {
      entries.set(planId, structuredClone(outcomes));
    },
  };
  return result;
}

describe("sync orchestrator", () => {
  it("retains plans, persists settings through the host, and locks both operations", async () => {
    const libby: BookSnapshot[] = [
      {
        bookId: "libby-1",
        title: "Same Book",
        author: "Same Author",
        fields: { note: { value: "new", updatedAt: "2026-01-02T00:00:00Z" } },
      },
    ];
    const fable: BookSnapshot[] = [
      {
        bookId: "fable-1",
        title: "Same Book",
        author: "Same Author",
        fields: { note: { value: "old", updatedAt: "2026-01-01T00:00:00Z" } },
      },
    ];
    let stored: unknown = {};
    const locked = journal();
    const sync = createSyncOrchestrator({
      context,
      journal: locked,
      adapters: async () => ({ libby: adapter("libby", libby), fable: adapter("fable", fable) }),
      readSettings: async () => stored,
      writeSettings: async (settings) => {
        stored = settings;
      },
    });

    const plan = await sync.previewSync();
    const report = await sync.applySync(plan.id, { selected: plan.operations.map(({ id }) => id), removals: [] });
    expect(report.outcomes[0]?.status).toBe("success");
    expect(locked.locks).toBe(1);

    await sync.saveSettings({ removals: "all-supported" });
    expect(stored).toEqual({ removals: "all-supported" });
    await expect(sync.applySync(plan.id, { selected: [], removals: [] })).rejects.toThrow(
      "Preview is unavailable or settings changed; preview again",
    );
    expect(locked.locks).toBe(2);
  });
});
