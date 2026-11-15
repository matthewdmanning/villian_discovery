import { describe, expect, it } from "vitest";
import type { BookSnapshot, SnapshotField, SnapshotValue, SyncProvider } from "../src/sync.js";
import { resolveSyncSettings, SYNC_FALLBACKS, type SyncSettings } from "../src/sync-config.js";
import {
  applySync,
  previewSync,
  type SyncAdapter,
  type SyncAdapters,
  type SyncApplyReport,
  type SyncContext,
  type SyncJournal,
  type SyncOperation,
  type SyncPlan,
  syncDecisionKey,
} from "../src/sync-plan.js";

const context: SyncContext = { userId: "user-1", connectionId: "connection-1" };
const newer = "2026-01-02T00:00:00Z";
const older = "2026-01-01T00:00:00Z";

type AdapterOptions = {
  verified?: boolean;
  writableFields?: string[];
  visibility?: Record<string, "private" | "public">;
  failWrites?: string[];
  commitThenThrow?: string[];
  failNextRead?: boolean;
};

type FakeAdapter = SyncAdapter & {
  state: BookSnapshot[];
  reads: number;
  writes: SyncOperation[];
  failNextRead: boolean;
};

type FakeJournal = SyncJournal & {
  locks: number;
  writes: number;
};

function field(value: SnapshotValue, updatedAt?: string, visibility: "private" | "public" = "private"): SnapshotField {
  return { value, ...(updatedAt ? { updatedAt } : {}), visibility };
}

function pair(
  libbyFields: Record<string, SnapshotField> = { note: field("new note", newer) },
  fableFields: Record<string, SnapshotField> = { note: field("old note", older) },
  fableKnownFields?: string[],
): Record<SyncProvider, BookSnapshot[]> {
  const common = { title: "Same Book", author: "Same Author", workId: "work-1" };
  return {
    libby: [{ ...common, bookId: "libby-1", fields: structuredClone(libbyFields) }],
    fable: [
      {
        ...common,
        bookId: "fable-1",
        ...(fableKnownFields ? { knownFields: fableKnownFields } : {}),
        fields: structuredClone(fableFields),
      },
    ],
  };
}

function makeAdapter(provider: SyncProvider, snapshots: BookSnapshot[], options: AdapterOptions = {}): FakeAdapter {
  const adapter: FakeAdapter = {
    verified: options.verified ?? true,
    writableFields: options.writableFields ?? ["note", "rating", "tags"],
    ...(options.visibility ? { visibility: options.visibility } : {}),
    state: structuredClone(snapshots),
    reads: 0,
    writes: [],
    failNextRead: options.failNextRead ?? false,
    async read() {
      this.reads += 1;
      if (this.failNextRead) {
        this.failNextRead = false;
        throw new Error(`${provider} read failed`);
      }
      return structuredClone(this.state);
    },
    async write(_writeContext, operation, assertCurrent) {
      await assertCurrent();
      this.writes.push(structuredClone(operation));
      const book = this.state.find((candidate) => candidate.bookId === operation.bookId);
      if (!book) throw new Error(`Unknown ${provider} book`);
      const current = book.fields[operation.field];
      if (JSON.stringify(current) !== JSON.stringify(operation.before)) throw new Error("CAS mismatch");
      if (options.failWrites?.includes(operation.field)) throw new Error(`${operation.field} write failed`);
      const visibility = current?.visibility ?? this.visibility?.[operation.field];
      book.fields[operation.field] = {
        value: structuredClone(operation.after),
        ...(visibility ? { visibility } : {}),
        updatedAt: "2026-01-03T00:00:00Z",
      };
      if (options.commitThenThrow?.includes(operation.field)) throw new Error("write committed before failure");
    },
  };
  return adapter;
}

function makeJournal(): FakeJournal {
  const entries = new Map<string, SyncApplyReport["outcomes"]>();
  return {
    locks: 0,
    writes: 0,
    async withLock<T>(_context: SyncContext, action: () => Promise<T>): Promise<T> {
      this.locks += 1;
      return action();
    },
    async read(_context, planId) {
      return structuredClone(entries.get(planId) ?? []);
    },
    async write(_context, planId, outcomes) {
      this.writes += 1;
      entries.set(planId, structuredClone(outcomes));
    },
  };
}

async function preview(
  snapshots = pair(),
  settingsInput: Partial<SyncSettings> = {},
  adapterOptions: { libby?: AdapterOptions; fable?: AdapterOptions } = {},
) {
  const settings = resolveSyncSettings(settingsInput);
  const adapters: SyncAdapters = {
    libby: makeAdapter("libby", snapshots.libby, adapterOptions.libby),
    fable: makeAdapter("fable", snapshots.fable, adapterOptions.fable),
  };
  const plan = await previewSync({ context, settings, adapters });
  return { settings, adapters, plan };
}

function approvals(plan: SyncPlan, extra: { removals?: string[]; publicCopies?: string[] } = {}) {
  return {
    selected: plan.operations.map((operation) => operation.id),
    removals: extra.removals ?? [],
    publicCopies: extra.publicCopies ?? [],
  };
}

describe("sync plan preview and apply", () => {
  it("allows explicitly confirmed editions of the same work to share a destination", async () => {
    const snapshots = pair();
    snapshots.libby.push({ ...structuredClone(snapshots.libby[0]!), bookId: "another-format" });
    const adapters: SyncAdapters = {
      libby: makeAdapter("libby", snapshots.libby),
      fable: makeAdapter("fable", snapshots.fable),
    };
    const plan = await previewSync({
      context,
      settings: SYNC_FALLBACKS,
      adapters,
      options: { matches: { "libby-1": "fable-1", "another-format": "fable-1" } },
    });
    expect(plan.operations).toHaveLength(1);
  });
  it("rejects replay when a successful destination later reverts exactly to its before value", async () => {
    const { settings, adapters, plan } = await preview();
    const journal = makeJournal();
    await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    (adapters.fable as FakeAdapter).state[0]!.fields.note = structuredClone(plan.operations[0]!.before!);
    await expect(applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) })).rejects.toThrow(
      /previously applied/,
    );
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(1);
  });

  it("checks source revisions again at the adapter write boundary", async () => {
    const { settings, adapters, plan } = await preview();
    const write = adapters.fable.write.bind(adapters.fable);
    adapters.fable.write = async (owner, operation, assertCurrent) => {
      (adapters.libby as FakeAdapter).state[0]!.fields.note = field("changed source", "2026-01-04T00:00:00Z");
      await write(owner, operation, assertCurrent);
    };
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      journal: makeJournal(),
      approvals: approvals(plan),
    });
    expect(report.outcomes[0]?.status).toBe("failed");
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(0);
  });

  it("rejects confirmed links that collapse unrelated Libby works into one destination", async () => {
    const snapshots = pair();
    snapshots.libby.push({ bookId: "unrelated", title: "Different work", author: "Different author", fields: {} });
    const adapters: SyncAdapters = {
      libby: makeAdapter("libby", snapshots.libby),
      fable: makeAdapter("fable", snapshots.fable),
    };
    await expect(
      previewSync({
        context,
        settings: SYNC_FALLBACKS,
        adapters,
        options: { matches: { "libby-1": "fable-1", unrelated: "fable-1" } },
      }),
    ).rejects.toThrow(/unrelated/);
  });
  it("rechecks the settings reader after taking the user lock", async () => {
    const { settings, adapters, plan } = await preview();
    await expect(
      applySync({
        context,
        settings,
        readSettings: async () => ({ ...settings, publicCopy: "block" }),
        plan,
        adapters,
        journal: makeJournal(),
        approvals: approvals(plan),
      }),
    ).rejects.toThrow(/Settings/);
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(0);
  });

  it("stops remaining writes when capabilities change during apply", async () => {
    const { settings, adapters, plan } = await preview(
      pair(
        { note: field("new", newer), rating: field(5, newer) },
        { note: field("old", older), rating: field(1, older) },
      ),
    );
    const write = adapters.fable.write.bind(adapters.fable);
    adapters.fable.write = async (owner, operation, assertCurrent) => {
      await write(owner, operation, assertCurrent);
      (adapters.fable.writableFields as string[]).splice(0);
    };
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      journal: makeJournal(),
      approvals: approvals(plan),
    });
    expect(report.outcomes.map((outcome) => outcome.status)).toEqual(["success", "skipped"]);
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(1);
  });

  it("previews explicit confirmed book links without guessing between ambiguous works", async () => {
    const snapshots = pair();
    delete snapshots.libby[0]!.workId;
    delete snapshots.fable[0]!.workId;
    snapshots.fable.push({ ...snapshots.fable[0]!, bookId: "other-edition" });
    const adapters: SyncAdapters = {
      libby: makeAdapter("libby", snapshots.libby),
      fable: makeAdapter("fable", snapshots.fable),
    };
    const plan = await previewSync({
      context,
      settings: SYNC_FALLBACKS,
      adapters,
      options: { matches: { "libby-1": "fable-1" } },
    });
    expect(plan.operations.some((operation) => operation.bookId === "fable-1")).toBe(true);
    expect(plan.operations.some((operation) => operation.bookId === "other-edition")).toBe(false);
  });
  it("previews and applies a safe metadata change while preserving destination privacy", async () => {
    const { settings, adapters, plan } = await preview();
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({ field: "note", source: "libby", target: "fable" });
    expect(plan.operations[0]!.blocked).toBeUndefined();

    const journal = makeJournal();
    const report = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });

    expect(report.outcomes).toEqual([
      { operationId: plan.operations[0]!.id, status: "success", message: "Destination value verified" },
    ]);
    expect((adapters.fable as FakeAdapter).state[0]!.fields.note).toMatchObject({
      value: "new note",
      visibility: "private",
      updatedAt: "2026-01-03T00:00:00Z",
    });
  });

  it("blocks unverified providers, unknown destinations, and default removals", async () => {
    const unverified = await preview(pair(), {}, { fable: { verified: false } });
    expect(unverified.plan.operations[0]).toMatchObject({ blocked: "Provider contracts are not verified" });

    const unknown = await preview(pair({ note: field("new note", newer) }, {}, []));
    expect(unknown.plan.operations[0]).toMatchObject({
      blocked: "Destination field is unknown; it is not an observed empty value",
    });

    const removal = await preview(pair({ note: field(null, newer) }));
    expect(removal.plan.operations[0]).toMatchObject({ blocked: "Removals are disabled in your settings" });
  });

  it("requires removal approval even when removals are enabled", async () => {
    const { settings, adapters, plan } = await preview(pair({ note: field(null, newer) }), {
      removals: "all-supported",
    });
    const journal = makeJournal();
    const report = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(report.outcomes[0]).toMatchObject({ status: "skipped", message: "Explicit removal approval is required" });
  });

  it("requires independent public-copy approval for private-to-public changes", async () => {
    const snapshots = pair({ note: field("new note", newer, "private") }, { note: field("old note", older, "public") });
    const { settings, adapters, plan } = await preview(snapshots);
    expect(plan.operations[0]).toMatchObject({ publicExposure: true });
    const journal = makeJournal();
    const report = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(report.outcomes[0]).toMatchObject({
      status: "skipped",
      message: "Explicit public-copy approval is required",
    });
  });

  it.each([
    [
      "source",
      (adapters: SyncAdapters) =>
        ((adapters.libby as FakeAdapter).state[0]!.fields.note = field("changed source", "2026-01-04T00:00:00Z")),
    ],
    [
      "target",
      (adapters: SyncAdapters) =>
        ((adapters.fable as FakeAdapter).state[0]!.fields.note = field("changed target", "2026-01-04T00:00:00Z")),
    ],
  ])("rejects a stale %s before any write", async (_side, mutate) => {
    const { settings, adapters, plan } = await preview();
    mutate(adapters);
    const journal = makeJournal();

    await expect(applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) })).rejects.toThrow(
      "Library data changed; create a new preview",
    );
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(0);
  });

  it.each([
    ["settings", () => ({ ...SYNC_FALLBACKS, publicCopy: "block" as const })],
    ["context", () => context],
  ])("rejects changed %s before writing", async (kind, value) => {
    const { settings, adapters, plan } = await preview();
    const journal = makeJournal();
    const input =
      kind === "context"
        ? {
            context: { ...context, userId: "other-user" },
            settings,
            plan,
            adapters,
            journal,
            approvals: approvals(plan),
          }
        : { context, settings: value(), plan, adapters, journal, approvals: approvals(plan) };
    await expect(applySync(input)).rejects.toThrow(
      kind === "context" ? "Connected account changed" : "Settings or capabilities changed",
    );
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(0);
  });

  it("rejects changed capabilities and modified plans before writing", async () => {
    const first = await preview();
    first.adapters.fable = makeAdapter("fable", (first.adapters.fable as FakeAdapter).state, { verified: false });
    await expect(
      applySync({
        context,
        settings: first.settings,
        plan: first.plan,
        adapters: first.adapters,
        journal: makeJournal(),
        approvals: approvals(first.plan),
      }),
    ).rejects.toThrow("Settings or capabilities changed");

    const second = await preview();
    const modified = structuredClone(second.plan);
    modified.operations[0]!.after = "tampered";
    await expect(
      applySync({
        context,
        settings: second.settings,
        plan: modified,
        adapters: second.adapters,
        journal: makeJournal(),
        approvals: approvals(modified),
      }),
    ).rejects.toThrow("Preview was modified; create a new preview");
    expect((second.adapters.fable as FakeAdapter).writes).toHaveLength(0);
  });

  it("reports a failed write and continues with later operations", async () => {
    const snapshots = pair(
      { note: field("new note", newer), rating: field(5, newer) },
      { note: field("old note", older), rating: field(3, older) },
    );
    const { settings, adapters, plan } = await preview(snapshots, {}, { fable: { failWrites: ["note"] } });
    const journal = makeJournal();
    const report = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(report.outcomes).toEqual([
      {
        operationId: plan.operations.find((operation) => operation.field === "note")!.id,
        status: "failed",
        message: "Error: note write failed",
      },
      {
        operationId: plan.operations.find((operation) => operation.field === "rating")!.id,
        status: "success",
        message: "Destination value verified",
      },
    ]);
    expect((adapters.fable as FakeAdapter).state[0]!.fields.rating?.value).toBe(5);
    expect((adapters.fable as FakeAdapter).state[0]!.fields.note?.value).toBe("old note");
  });

  it("verifies a write that committed before throwing", async () => {
    const { settings, adapters, plan } = await preview(pair(), {}, { fable: { commitThenThrow: ["note"] } });
    const report = await applySync({
      context,
      settings,
      plan,
      adapters,
      journal: makeJournal(),
      approvals: approvals(plan),
    });
    expect(report.outcomes[0]).toMatchObject({ status: "success", message: "Destination value verified" });
  });

  it("does not replay a journaled success", async () => {
    const { settings, adapters, plan } = await preview();
    const journal = makeJournal();
    await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    const writes = (adapters.fable as FakeAdapter).writes.length;
    const repeat = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect((adapters.fable as FakeAdapter).writes).toHaveLength(writes);
    expect(repeat.outcomes[0]).toMatchObject({ status: "success" });
  });

  it("keeps uncertain verification unknown and reads again before retrying", async () => {
    const { settings, adapters, plan } = await preview();
    const fable = adapters.fable as FakeAdapter;
    const originalWrite = fable.write.bind(fable);
    let attempts = 0;
    fable.write = async (writeContext, operation, assertCurrent) => {
      await assertCurrent();
      attempts += 1;
      if (attempts === 1) {
        fable.failNextRead = true;
        fable.writes.push(structuredClone(operation));
        return;
      }
      return originalWrite(writeContext, operation, assertCurrent);
    };
    const journal = makeJournal();
    const first = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(first.outcomes[0]).toMatchObject({ status: "unknown" });
    const writesBeforeRetry = fable.writes.length;
    const readsBeforeRetry = fable.reads;
    const second = await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(fable.reads).toBeGreaterThan(readsBeforeRetry);
    expect(fable.writes).toHaveLength(writesBeforeRetry + 1);
    expect(second.outcomes[0]).toMatchObject({ status: "success" });
  });

  it("uses the user-scoped lock and deterministic decision keys", async () => {
    const { settings, adapters, plan } = await preview();
    const journal = makeJournal();
    await applySync({ context, settings, plan, adapters, journal, approvals: approvals(plan) });
    expect(journal.locks).toBe(1);
    expect(syncDecisionKey(plan.rows.find((row) => row.field === "note")!)).toBe(JSON.stringify(["libby-1", "note"]));
  });

  it("rejects a confirmed match onto a destination already grouped with another Libby work", async () => {
    const snapshots = pair();
    snapshots.libby.push({ bookId: "unrelated", title: "Different work", author: "Different author", fields: {} });
    const adapters: SyncAdapters = {
      libby: makeAdapter("libby", snapshots.libby),
      fable: makeAdapter("fable", snapshots.fable),
    };
    await expect(
      previewSync({ context, settings: SYNC_FALLBACKS, adapters, options: { matches: { unrelated: "fable-1" } } }),
    ).rejects.toThrow(/unrelated/);
  });

  it("keeps existing workId matches when another Libby edition is confirmed to the same destination", async () => {
    const snapshots = pair();
    snapshots.libby.push({
      bookId: "audio-edition",
      title: "Same Book",
      author: "Same Author",
      fields: { note: field("new note", newer) },
    });
    const adapters: SyncAdapters = {
      libby: makeAdapter("libby", snapshots.libby),
      fable: makeAdapter("fable", snapshots.fable),
    };
    const plan = await previewSync({
      context,
      settings: SYNC_FALLBACKS,
      adapters,
      options: { matches: { "audio-edition": "fable-1" } },
    });
    const group = plan.groups.find((candidate) => candidate.fable.some((book) => book.bookId === "fable-1"));
    expect(group?.libby.map((book) => book.bookId).sort()).toEqual(["audio-edition", "libby-1"]);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("keeps source privacy on furthest progress so the copy is not blocked as unknown", async () => {
    const { plan } = await preview(
      pair({ readingProgress: field(40, newer) }, { readingProgress: field(10, older) }),
      {},
      { fable: { writableFields: ["readingProgress"] } },
    );
    const operation = plan.operations.find((candidate) => candidate.field === "readingProgress");
    expect(operation).toMatchObject({ after: 40, target: "fable" });
    expect(operation?.blocked).toBeUndefined();
    expect(plan.rows.find((row) => row.field === "readingProgress")?.libby?.updatedAt).toBe(newer);
  });

  it("does not propose clearing a known but already empty reading status", async () => {
    const { plan } = await preview(
      pair({ checkedOut: field(false), finished: field(false) }, {}, ["readingStatus"]),
      {},
      { fable: { writableFields: ["readingStatus"] } },
    );
    expect(plan.operations.filter((operation) => operation.field === "readingStatus")).toHaveLength(0);
  });

  it("does not flag Fable-only books as needing a match", async () => {
    const snapshots = pair();
    snapshots.fable.push({ bookId: "never-borrowed", title: "Shelf Only", author: "Someone", fields: {} });
    const { plan } = await preview(snapshots);
    expect(plan.conflicts).toHaveLength(0);
  });
});
