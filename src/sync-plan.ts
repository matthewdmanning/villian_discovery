import { z } from "zod";
import {
  type BookSnapshot,
  isMetadataFieldInScope,
  matchSnapshotGroups,
  reconcileSnapshotsDetailed,
  type SnapshotField,
  type SnapshotValue,
  type SyncField,
  type SyncProvider,
} from "./sync.js";
import { resolveSyncSettings, type SyncSettings } from "./sync-config.js";

export type SyncContext = { userId: string; connectionId: string };
export type SyncOperation = {
  id: string;
  bookId: string;
  groupId: string;
  title: string;
  field: string;
  target: SyncProvider;
  source: SyncProvider;
  before: SnapshotField | undefined;
  after: SnapshotValue;
  removal: boolean;
  blocked?: string;
  /** Set when the target app has no record of this book yet: the book to find or create there. */
  create?: { title: string; author?: string; isbn?: string };
};
export interface SyncAdapter {
  readonly verified: boolean;
  /** The app's schema: shared field names its converter produces. Fields outside it do not exist in this app and are never synced to it. */
  readonly fields: readonly string[];
  readonly writableFields: readonly string[];
  /** Fields the app can set while adding a book it does not hold yet. */
  readonly createFields?: readonly string[];
  /** Convert the app's native records into shared-schema snapshots that use only `fields`. */
  read(context: SyncContext): Promise<BookSnapshot[]>;
  /** Verified adapters must call assertCurrent immediately before submitting a conditional before-value/version write. */
  write(context: SyncContext, operation: SyncOperation, assertCurrent: () => Promise<void>): Promise<void>;
}
export type SyncAdapters = Record<SyncProvider, SyncAdapter>;
export type SyncPreviewOptions = {
  resolutions?: Record<string, SyncProvider> | undefined;
  editions?: Record<string, string> | undefined;
  matches?: Record<string, string> | undefined;
};
export type SyncPlan = {
  id: string;
  context: SyncContext;
  settings: SyncSettings;
  rows: SyncField[];
  groups: ReturnType<typeof reconcileSnapshotsDetailed>["groups"];
  operations: SyncOperation[];
  conflicts: { message: string; libbyBookIds: string[]; fableBookIds: string[] }[];
  snapshots: Record<SyncProvider, BookSnapshot[]>;
  options: SyncPreviewOptions;
  capabilities: string;
  schemas: Record<SyncProvider, string[]>;
};
export type SyncOutcome = {
  operationId: string;
  status: "success" | "failed" | "unknown" | "skipped";
  message: string;
};
export type SyncApplyReport = { planId: string; outcomes: SyncOutcome[] };
export interface SyncJournal {
  withLock<T>(context: SyncContext, action: () => Promise<T>): Promise<T>;
  read(context: SyncContext, planId: string): Promise<SyncOutcome[]>;
  write(context: SyncContext, planId: string, outcomes: SyncOutcome[]): Promise<void>;
}
const ContextSchema = z.object({ userId: z.string().min(1), connectionId: z.string().min(1) }).strict();
const ApprovalSchema = z.object({ selected: z.array(z.string()), removals: z.array(z.string()) }).strict();
const OptionsSchema = z
  .object({
    resolutions: z.record(z.string(), z.enum(["libby", "fable"])).optional(),
    editions: z.record(z.string(), z.string()).optional(),
    matches: z.record(z.string(), z.string().min(1)).optional(),
  })
  .strict();
export type SyncApprovals = z.infer<typeof ApprovalSchema>;

/** Use this function to compare normalized JSON deterministically across object-key order. */
function stable(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right, "en")))
        : item,
    ) ?? "undefined"
  );
}

/** Use this function to compare provider field values without making membership ordering meaningful. */
function sameValue(left: unknown, right: unknown): boolean {
  return (
    stable(Array.isArray(left) ? [...left].sort() : left) === stable(Array.isArray(right) ? [...right].sort() : right)
  );
}

/** Use this function to capture trusted writable capabilities as part of a preview's validity. */
function capabilities(adapters: SyncAdapters): string {
  return stable(
    Object.fromEntries(
      (["libby", "fable"] as const).map((provider) => [
        provider,
        {
          verified: adapters[provider].verified,
          schema: [...adapters[provider].fields].sort(),
          fields: [...adapters[provider].writableFields].sort(),
          create: [...(adapters[provider].createFields ?? [])].sort(),
        },
      ]),
    ),
  );
}

/** Use this function to keep only fields in one app's schema, so converter extras never reach comparison. */
function toSchema(books: BookSnapshot[], schema: readonly string[]): BookSnapshot[] {
  return books.map(({ knownFields, fields, ...book }) => ({
    ...book,
    ...(knownFields ? { knownFields: knownFields.filter((field) => schema.includes(field)) } : {}),
    fields: Object.fromEntries(Object.entries(fields).filter(([field]) => schema.includes(field))),
  }));
}

/** Use this function to read both providers without returning a partial preview when either source fails. */
async function readBoth(adapters: SyncAdapters, context: SyncContext): Promise<Record<SyncProvider, BookSnapshot[]>> {
  const [libby, fable] = await Promise.all([adapters.libby.read(context), adapters.fable.read(context)]);
  return { libby: toSchema(libby, adapters.libby.fields), fable: toSchema(fable, adapters.fable.fields) };
}

/** Use this function to classify explicit clears and reductions in string-array membership for mandatory removal review. */
function isRemoval(before: SnapshotField | undefined, after: SnapshotValue): boolean {
  return (
    after === null ||
    after === "" ||
    (Array.isArray(before?.value) && Array.isArray(after) && before.value.some((value) => !after.includes(value)))
  );
}

/** Use this function to create a deterministic field decision key shared by preview requests and the UI. */
export function syncDecisionKey(row: Pick<SyncField, "bookId" | "field">): string {
  return JSON.stringify([row.bookId, row.field]);
}

/** Use this function to propose adding a Libby book that Fable lacks: a checked-out book with progress above 0 is Currently Reading. */
function proposeCreate(libby: BookSnapshot[], adapters: SyncAdapters, planId: string): SyncOperation | undefined {
  const source = libby[0]!;
  const checkedOut = libby.some((book) => book.fields.checkedOut?.value === true);
  const progress = Math.max(0, ...libby.map((book) => Number(book.fields.readingProgress?.value) || 0));
  if (!checkedOut || progress <= 0 || !adapters.fable.fields.includes("readingStatus")) return undefined;
  const operation: SyncOperation = {
    id: JSON.stringify([planId, "fable", source.bookId, "readingStatus"]),
    bookId: source.bookId,
    groupId: source.bookId,
    title: source.title,
    field: "readingStatus",
    target: "fable",
    source: "libby",
    before: undefined,
    after: "currently-reading",
    removal: false,
    create: {
      title: source.title,
      ...(source.author ? { author: source.author } : {}),
      ...(source.isbn ? { isbn: source.isbn } : {}),
    },
  };
  if (!adapters.fable.verified || !adapters.libby.verified) operation.blocked = "Provider contracts are not verified";
  else if (!adapters.fable.createFields?.includes("readingStatus"))
    operation.blocked = "Adding books to this app is not verified";
  return operation;
}

/** Use this function to build reviewed operations from validated snapshots and trusted adapter capabilities. */
function buildPlan(
  context: SyncContext,
  settings: SyncSettings,
  snapshots: Record<SyncProvider, BookSnapshot[]>,
  adapters: SyncAdapters,
  options: SyncPreviewOptions,
  id: string = crypto.randomUUID(),
): SyncPlan {
  const selected = structuredClone(snapshots);
  const matches = options.matches ?? {};
  const editions = Object.entries(options.editions ?? {});
  if (editions.length) {
    const { groups } = matchSnapshotGroups(selected.libby, selected.fable, settings.matching, matches);
    const groupsById = new Map(groups.map((group) => [group.groupId, group]));
    // A group ID lists its members, so it changes when an edition joins; the chosen edition's group still applies.
    const groupsByBook = new Map(
      groups.flatMap((group) => [...group.libby, ...group.fable].map((book) => [book.bookId, group] as const)),
    );
    for (const provider of ["libby", "fable"] as const) {
      for (const [groupId, editionId] of editions) {
        const group = groupsById.get(groupId) ?? groupsByBook.get(editionId);
        const edition = group?.[provider].find((book) => book.bookId === editionId);
        if (!group || !edition) continue;
        const members = new Set(group[provider].map((member) => member.bookId));
        for (const book of selected[provider]) {
          if (!members.has(book.bookId)) continue;
          if (edition.fields.readingProgress)
            book.fields.readingProgress = structuredClone(edition.fields.readingProgress);
          else delete book.fields.readingProgress;
        }
      }
    }
  }
  const result = reconcileSnapshotsDetailed(selected.libby, selected.fable, settings, matches);
  const rows = structuredClone(result.rows);
  const resultGroups = new Map(result.groups.map((group) => [group.groupId, group]));
  const operations: SyncOperation[] = [];
  for (const row of rows) {
    const decision = options.resolutions?.[syncDecisionKey(row)];
    const authoritative = ["readingProgress", "checkedOut", "finished", "readingStatus"].includes(row.field);
    if (row.conflict && decision && !authoritative && row[decision]) {
      row.value = row[decision]!.value;
      row.source = decision;
      delete row.conflict;
    }
    if (row.conflict || row.value === undefined || !row.source) continue;
    if (!authoritative && !isMetadataFieldInScope(row.field, settings.metadataScope)) continue;
    const target: SyncProvider = row.source === "libby" ? "fable" : "libby";
    if (authoritative && target === "libby") continue;
    if (!adapters[target].fields.includes(row.field)) continue;
    if (
      target === "fable" &&
      ["checkedOut", "finished"].includes(row.field) &&
      adapters.fable.writableFields.includes("readingStatus")
    )
      continue;
    const group = row.groupId === undefined ? undefined : resultGroups.get(row.groupId);
    if (!group) continue;
    for (const book of group[target]) {
      const before = book.fields[row.field];
      if (before && sameValue(before.value, row.value)) continue;
      if (!before && (row.value === null || row.value === "")) continue;
      if (
        row.field === "readingProgress" &&
        !settings.allowProgressDecrease &&
        typeof before?.value === "number" &&
        typeof row.value === "number" &&
        row.value < before.value
      )
        continue;
      const removal = isRemoval(before, row.value);
      const operation: SyncOperation = {
        id: JSON.stringify([id, target, book.bookId, row.field]),
        bookId: book.bookId,
        groupId: group.groupId,
        title: row.title,
        field: row.field,
        target,
        source: row.source,
        before: before ? structuredClone(before) : undefined,
        after: structuredClone(row.value),
        removal,
      };
      if (!adapters[target].verified || !adapters[row.source].verified)
        operation.blocked = "Provider contracts are not verified";
      else if (!adapters[target].writableFields.includes(row.field))
        operation.blocked = "This field is not a verified writable capability";
      else if (/highlight|annotation|bookmark/i.test(row.field))
        operation.blocked = "Compatible edition and passage anchors are not verified";
      else if (removal && settings.removals === "none") operation.blocked = "Removals are disabled in your settings";
      operations.push(operation);
    }
  }
  const unmatched = [];
  for (const group of result.groups.filter((candidate) => candidate.libby.length && !candidate.fable.length)) {
    const create = proposeCreate(group.libby, adapters, id);
    if (create) operations.push(create);
    else
      unmatched.push({
        message: `No matched destination for ${group.title}; it is not checked out with progress, so no Fable book is added`,
        libbyBookIds: group.libby.map((book) => book.bookId),
        fableBookIds: [],
      });
  }
  return {
    id,
    context: structuredClone(context),
    settings,
    rows,
    groups: result.groups,
    operations,
    conflicts: [...result.conflicts, ...unmatched],
    snapshots: structuredClone(snapshots),
    options: structuredClone(options),
    capabilities: capabilities(adapters),
    schemas: { libby: [...adapters.libby.fields], fable: [...adapters.fable.fields] },
  };
}

/** Use this function to preview both providers using validated user settings; callers must retain the resulting plan in trusted user-scoped storage. */
export async function previewSync(input: {
  context: SyncContext;
  settings: unknown;
  adapters: SyncAdapters;
  options?: SyncPreviewOptions;
}): Promise<SyncPlan> {
  const context = ContextSchema.parse(input.context);
  const settings = resolveSyncSettings(input.settings);
  return buildPlan(
    context,
    settings,
    await readBoth(input.adapters, context),
    input.adapters,
    OptionsSchema.parse(input.options ?? {}),
  );
}

/** Use this function to normalize snapshot record ordering before checking a preview for stale data. */
function snapshotKey(snapshots: Record<SyncProvider, BookSnapshot[]>): string {
  return stable({
    libby: [...snapshots.libby].sort((a, b) => a.bookId.localeCompare(b.bookId, "en")),
    fable: [...snapshots.fable].sort((a, b) => a.bookId.localeCompare(b.bookId, "en")),
  });
}

/** Index each provider's snapshots by book ID for constant-time lookups. */
function indexBooks(snapshots: Record<SyncProvider, BookSnapshot[]>): Record<SyncProvider, Map<string, BookSnapshot>> {
  return {
    libby: new Map(snapshots.libby.map((book) => [book.bookId, book])),
    fable: new Map(snapshots.fable.map((book) => [book.bookId, book])),
  };
}

/** Use this function to find the destination books that now match a created book's source. */
function createdBooks(
  operation: SyncOperation,
  snapshots: Record<SyncProvider, BookSnapshot[]>,
  matching: SyncSettings["matching"],
): BookSnapshot[] {
  const { groups } = matchSnapshotGroups(snapshots.libby, snapshots.fable, matching);
  return groups.find((group) => group.libby.some((book) => book.bookId === operation.bookId))?.fable ?? [];
}

/** Use this function to verify a proposed value against a fresh destination read; a created book is found by matching it to its source. */
function appliedValue(
  operation: SyncOperation,
  snapshots: Record<SyncProvider, BookSnapshot[]>,
  matching: SyncSettings["matching"],
): boolean {
  const books = operation.create
    ? createdBooks(operation, snapshots, matching)
    : snapshots[operation.target].filter((book) => book.bookId === operation.bookId);
  return books.some((book) => {
    const field = book.fields[operation.field];
    return !!field && sameValue(field.value, operation.after);
  });
}

/** Use this function to apply a trusted preview with user-scoped locking, fresh reads, mandatory approvals, and verified per-operation outcomes. */
export async function applySync(input: {
  context: SyncContext;
  settings: unknown;
  readSettings?: () => Promise<unknown>;
  plan: SyncPlan;
  adapters: SyncAdapters;
  journal: SyncJournal;
  approvals: unknown;
}): Promise<SyncApplyReport> {
  const context = ContextSchema.parse(input.context);
  const settings = resolveSyncSettings(input.settings);
  const approvals = ApprovalSchema.parse(input.approvals);
  if (stable(context) !== stable(input.plan.context))
    throw new Error("Connected account changed; create a new preview");
  if (stable(settings) !== stable(input.plan.settings) || capabilities(input.adapters) !== input.plan.capabilities)
    throw new Error("Settings or capabilities changed; create a new preview");
  const allowedIds = new Set(input.plan.operations.map((operation) => operation.id));
  if ([...approvals.selected, ...approvals.removals].some((id) => !allowedIds.has(id)))
    throw new Error("Unknown operation approval");
  return input.journal.withLock(context, async () => {
    const outcomes = new Map(
      (await input.journal.read(context, input.plan.id)).map((outcome) => [outcome.operationId, outcome]),
    );
    const expected = structuredClone(input.plan.snapshots);
    /** A created book joins the expected snapshots, so later checks do not read it as outside change. */
    const adoptCreated = (operation: SyncOperation, fresh: Record<SyncProvider, BookSnapshot[]>) => {
      if (!operation.create) return;
      for (const book of createdBooks(operation, fresh, settings.matching))
        if (!expected.fable.some((known) => known.bookId === book.bookId)) expected.fable.push(structuredClone(book));
    };
    const persist = async (outcome: SyncOutcome) => {
      outcomes.set(outcome.operationId, outcome);
      await input.journal.write(context, input.plan.id, [...outcomes.values()]);
    };
    const validateConfig = async () => {
      const currentSettings = resolveSyncSettings(input.readSettings ? await input.readSettings() : input.settings);
      if (
        stable(currentSettings) !== stable(input.plan.settings) ||
        capabilities(input.adapters) !== input.plan.capabilities
      )
        throw new Error("Settings or capabilities changed; create a new preview");
    };
    const validate = async () => {
      await validateConfig();
      const fresh = await readBoth(input.adapters, context);
      const parsed = reconcileSnapshotsDetailed(fresh.libby, fresh.fable, settings);
      fresh.libby = parsed.libby;
      fresh.fable = parsed.fable;
      const freshBooks = indexBooks(fresh);
      for (const operation of input.plan.operations) {
        if (outcomes.get(operation.id)?.status === "success" && !appliedValue(operation, fresh, settings.matching))
          throw new Error("A previously applied value changed; create a new preview");
        if (outcomes.has(operation.id) && appliedValue(operation, fresh, settings.matching)) {
          adoptCreated(operation, fresh);
          const book = expected[operation.target].find((candidate) => candidate.bookId === operation.bookId);
          const actual = freshBooks[operation.target].get(operation.bookId)?.fields[operation.field];
          if (book && actual) book.fields[operation.field] = structuredClone(actual);
          if (outcomes.get(operation.id)?.status === "success") continue;
          await persist({
            operationId: operation.id,
            status: "success",
            message: "Verified the proposed value at the destination",
          });
        }
      }
      if (snapshotKey(expected) !== snapshotKey(fresh)) throw new Error("Library data changed; create a new preview");
      return fresh;
    };
    await validate();
    const original = buildPlan(
      context,
      settings,
      input.plan.snapshots,
      input.adapters,
      input.plan.options,
      input.plan.id,
    );
    if (stable(original.operations) !== stable(input.plan.operations))
      throw new Error("Preview was modified; create a new preview");
    for (const operation of input.plan.operations.filter((candidate) => approvals.selected.includes(candidate.id))) {
      if (outcomes.get(operation.id)?.status === "success") continue;
      let reason = operation.blocked;
      if (operation.removal && !approvals.removals.includes(operation.id))
        reason = "Explicit removal approval is required";
      if (reason) {
        await persist({ operationId: operation.id, status: "skipped", message: reason });
        continue;
      }
      await persist({
        operationId: operation.id,
        status: "unknown",
        message: "Write prepared; outcome requires verification",
      });
      try {
        // Provider state is re-read inside assertCurrent, which verified adapters must call before writing.
        await validateConfig();
      } catch (error) {
        await persist({ operationId: operation.id, status: "skipped", message: String(error) });
        break;
      }
      let failure: unknown;
      try {
        await input.adapters[operation.target].write(context, structuredClone(operation), async () => {
          await validate();
        });
      } catch (error) {
        failure = error;
      }
      try {
        const fresh = await readBoth(input.adapters, context);
        if (appliedValue(operation, fresh, settings.matching)) {
          adoptCreated(operation, fresh);
          const target = expected[operation.target].find((book) => book.bookId === operation.bookId);
          const written = fresh[operation.target].find((book) => book.bookId === operation.bookId)?.fields[
            operation.field
          ];
          if (target && written) target.fields[operation.field] = structuredClone(written);
          await persist({ operationId: operation.id, status: "success", message: "Destination value verified" });
        } else {
          const actual = fresh[operation.target].find((book) => book.bookId === operation.bookId)?.fields[
            operation.field
          ];
          const unchanged = stable(actual) === stable(operation.before);
          await persist({
            operationId: operation.id,
            status: unchanged && failure ? "failed" : "unknown",
            message: failure ? String(failure) : "The provider did not confirm the proposed value",
          });
        }
      } catch {
        await persist({
          operationId: operation.id,
          status: "unknown",
          message: "Unable to verify the destination; do not replay without a fresh read",
        });
      }
    }
    return { planId: input.plan.id, outcomes: [...outcomes.values()] };
  });
}

/** Use this function to create a single-process journal: outcomes live in memory and one apply runs per user at a time. */
export function createMemoryJournal(): SyncJournal {
  // ponytail: in-memory journal; a durable user-scoped journal and cross-process locking are needed for production.
  const entries = new Map<string, SyncOutcome[]>();
  const locks = new Set<string>();
  const key = (owner: SyncContext, planId: string) => JSON.stringify([owner.userId, owner.connectionId, planId]);
  return {
    async withLock(owner, action) {
      if (locks.has(owner.userId)) throw new Error("A sync is already applying for this user");
      locks.add(owner.userId);
      try {
        return await action();
      } finally {
        locks.delete(owner.userId);
      }
    },
    async read(owner, planId) {
      return structuredClone(entries.get(key(owner, planId)) ?? []);
    },
    async write(owner, planId, outcomes) {
      entries.set(key(owner, planId), structuredClone(outcomes));
    },
  };
}
