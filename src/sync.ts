import { z } from "zod";
import { normalizeName, normalizeTitle, toIsbn13 } from "./matcher.js";
import { resolveSyncSettings, type SyncSettings } from "./sync-config.js";

export const SnapshotVisibilitySchema = z.enum(["private", "public", "unknown"]);
export const SnapshotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
export const SnapshotFieldSchema = z
  .object({
    value: SnapshotValueSchema,
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    visibility: SnapshotVisibilitySchema.optional(),
  })
  .strict();

export const BookSnapshotSchema = z
  .object({
    bookId: z.string().min(1),
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    isbn: z.string().min(1).optional(),
    workId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    knownFields: z.array(z.string().min(1)).optional(),
    fields: z.record(z.string().min(1), SnapshotFieldSchema),
  })
  .strict()
  .superRefine((book, ctx) => {
    const knownFields = book.knownFields ?? [];
    if (new Set(knownFields).size !== knownFields.length) {
      ctx.addIssue({ code: "custom", path: ["knownFields"], message: "knownFields must not contain duplicates" });
    }
    for (const [field, snapshot] of Object.entries(book.fields)) {
      const valid =
        field === "readingProgress"
          ? typeof snapshot.value === "number" &&
            Number.isFinite(snapshot.value) &&
            snapshot.value >= 0 &&
            snapshot.value <= 100
          : field === "checkedOut" || field === "finished"
            ? typeof snapshot.value === "boolean"
            : true;
      if (!valid) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", field, "value"],
          message: `Invalid value for authoritative field ${field}`,
        });
      }
    }
  });

export type SnapshotValue = z.infer<typeof SnapshotValueSchema>;
export type SnapshotField = z.infer<typeof SnapshotFieldSchema>;
export type BookSnapshot = z.infer<typeof BookSnapshotSchema>;
export type SyncProvider = "libby" | "fable";

export type SyncField = {
  bookId: string;
  title: string;
  field: string;
  groupId?: string;
  libby?: SnapshotField;
  fable?: SnapshotField;
  value?: SnapshotField["value"];
  source?: SyncProvider;
  conflict?: string;
};

export type SnapshotGroup = {
  groupId: string;
  title: string;
  libby: BookSnapshot[];
  fable: BookSnapshot[];
};

export type SnapshotMatchConflict = {
  code: "ambiguous-match";
  message: string;
  libbyBookIds: string[];
  fableBookIds: string[];
};

export type ReconcileResult = {
  rows: SyncField[];
  groups: SnapshotGroup[];
  conflicts: SnapshotMatchConflict[];
  libby: BookSnapshot[];
  fable: BookSnapshot[];
};

const AUTHORITATIVE_FIELDS = new Set(["readingProgress", "checkedOut", "finished"]);
const MEMBERSHIP_FIELDS = new Set(["list", "lists", "membership", "memberships", "shelf", "shelves", "tags"]);

/**
 * Use this function to validate one provider's untrusted snapshots and reject duplicate canonical IDs.
 * Inputs: `input` — provider data to validate; `provider` — provider label for diagnostics.
 * Dependencies: `BookSnapshotSchema`, Zod array parsing.
 */
function parseSnapshots(input: unknown, provider: "Libby" | "Fable"): BookSnapshot[] {
  const snapshots = z.array(BookSnapshotSchema).parse(input);
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.bookId)) throw new Error(`Duplicate bookId in ${provider} snapshots: ${snapshot.bookId}`);
    seen.add(snapshot.bookId);
  }
  return snapshots;
}

/**
 * Use this function to normalize an optional ISBN into the shared ISBN-13 identity used for matching.
 * Inputs: `book` — a normalized provider snapshot; `book.isbn` or a legacy `isbn:` book ID is inspected.
 * Dependencies: `toIsbn13` from the matcher module.
 */
function isbn13For(book: BookSnapshot): string | undefined {
  const value = book.isbn ?? (book.bookId.toLowerCase().startsWith("isbn:") ? book.bookId.slice(5) : undefined);
  if (!value) return undefined;
  const normalized = value
    .replace(/^isbn:/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return toIsbn13(normalized);
}

/**
 * Use this function to list only identities that adapters may verify across providers.
 * Inputs: `book` — a provider snapshot carrying shared work or ISBN identity.
 * Dependencies: `isbn13For`.
 */
function sharedIdentityKeys(book: BookSnapshot): string[] {
  const keys: string[] = [];
  if (book.workId) keys.push(`work:${book.workId}`);
  const isbn = isbn13For(book);
  if (isbn) keys.push(`isbn13:${isbn}`);
  return keys;
}

/**
 * Use this function to compute the exact fallback key for work matching.
 * Inputs: `book` — a snapshot whose full title and author are compared.
 * Dependencies: `normalizeTitle`, `normalizeName` from the matcher module.
 */
export function workKey(book: BookSnapshot): string | undefined {
  if (!book.author) return undefined;
  const title = normalizeTitle(book.title, false);
  const author = normalizeName(book.author, true);
  return title && author ? `work-title:${title}|author:${author}` : undefined;
}

/**
 * Use this function to find a union-find root for one snapshot node.
 * Inputs: `parents` — node parent map; `node` — provider/index node key.
 * Dependencies: none.
 */
function findRoot(parents: Map<string, string>, node: string): string {
  let root = node;
  while (parents.get(root) !== root) root = parents.get(root)!;
  let current = node;
  while (parents.get(current) !== current) {
    const next = parents.get(current)!;
    parents.set(current, root);
    current = next;
  }
  return root;
}

/**
 * Use this function to join verified snapshot identities into one cross-provider group.
 * Inputs: `parents` — union-find parent map; `left` and `right` — provider/index node keys.
 * Dependencies: `findRoot`.
 */
function joinRoots(parents: Map<string, string>, left: string, right: string): void {
  const leftRoot = findRoot(parents, left);
  const rightRoot = findRoot(parents, right);
  if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
}

/**
 * Use this function to return whether a union-find root has members from both providers.
 * Inputs: `parents` — union-find parent map; `libby` and `fable` — parsed snapshots; `root` — candidate root.
 * Dependencies: `findRoot`.
 */
function hasBothProviders(
  parents: Map<string, string>,
  libby: BookSnapshot[],
  fable: BookSnapshot[],
  root: string,
): boolean {
  for (let index = 0; index < libby.length; index++) {
    if (findRoot(parents, `l:${index}`) === root) {
      for (let fableIndex = 0; fableIndex < fable.length; fableIndex++) {
        if (findRoot(parents, `f:${fableIndex}`) === root) return true;
      }
      return false;
    }
  }
  return false;
}

/**
 * Use this function to group snapshots using canonical IDs, verified shared identities, and optional exact work fallback.
 * Inputs: `libbyInput` and `fableInput` — provider snapshot arrays; `matching` — identifier-only or work policy.
 * Dependencies: `parseSnapshots`, `sharedIdentityKeys`, `workKey`, and union-find helpers.
 */
export function matchSnapshotGroups(
  libbyInput: unknown,
  fableInput: unknown,
  matching?: SyncSettings["matching"],
): { groups: SnapshotGroup[]; conflicts: SnapshotMatchConflict[]; libby: BookSnapshot[]; fable: BookSnapshot[] } {
  const matchMode = matching ?? resolveSyncSettings({}).matching;
  const libby = parseSnapshots(libbyInput, "Libby");
  const fable = parseSnapshots(fableInput, "Fable");
  const parents = new Map<string, string>();
  for (let index = 0; index < libby.length; index++) parents.set(`l:${index}`, `l:${index}`);
  for (let index = 0; index < fable.length; index++) parents.set(`f:${index}`, `f:${index}`);

  const identityIndex = new Map<string, { libby: number[]; fable: number[] }>();
  const collectIdentity = (provider: "libby" | "fable", book: BookSnapshot, index: number): void => {
    for (const key of sharedIdentityKeys(book)) {
      const entry = identityIndex.get(key) ?? { libby: [], fable: [] };
      entry[provider].push(index);
      identityIndex.set(key, entry);
    }
  };
  for (let index = 0; index < libby.length; index++) collectIdentity("libby", libby[index]!, index);
  for (let index = 0; index < fable.length; index++) collectIdentity("fable", fable[index]!, index);
  for (const entry of identityIndex.values()) {
    if (!entry.libby.length || !entry.fable.length) continue;
    const firstLibby = entry.libby[0]!;
    const firstFable = entry.fable[0]!;
    for (const index of entry.libby.slice(1)) joinRoots(parents, `l:${firstLibby}`, `l:${index}`);
    for (const index of entry.fable.slice(1)) joinRoots(parents, `f:${firstFable}`, `f:${index}`);
    joinRoots(parents, `l:${firstLibby}`, `f:${firstFable}`);
  }

  const conflicts: SnapshotMatchConflict[] = [];
  if (matchMode === "work") {
    const workIndex = new Map<string, { libby: number[]; fable: number[] }>();
    const addWork = (provider: "libby" | "fable", book: BookSnapshot, index: number): void => {
      const root = findRoot(parents, `${provider === "libby" ? "l" : "f"}:${index}`);
      if (hasBothProviders(parents, libby, fable, root)) return;
      const key = workKey(book);
      if (!key) return;
      const entry = workIndex.get(key) ?? { libby: [], fable: [] };
      entry[provider].push(index);
      workIndex.set(key, entry);
    };
    for (let index = 0; index < libby.length; index++) addWork("libby", libby[index]!, index);
    for (let index = 0; index < fable.length; index++) addWork("fable", fable[index]!, index);
    for (const entry of workIndex.values()) {
      if (!entry.libby.length || !entry.fable.length) continue;
      if (entry.libby.length !== 1 || entry.fable.length !== 1) {
        conflicts.push({
          code: "ambiguous-match",
          message: "Exact normalized title and author match is ambiguous; choose an edition explicitly.",
          libbyBookIds: entry.libby.map((index) => libby[index]!.bookId),
          fableBookIds: entry.fable.map((index) => fable[index]!.bookId),
        });
        continue;
      }
      joinRoots(parents, `l:${entry.libby[0]!}`, `f:${entry.fable[0]!}`);
    }
  }

  const members = new Map<string, { libby: number[]; fable: number[] }>();
  for (let index = 0; index < libby.length; index++) {
    const root = findRoot(parents, `l:${index}`);
    const entry = members.get(root) ?? { libby: [], fable: [] };
    entry.libby.push(index);
    members.set(root, entry);
  }
  for (let index = 0; index < fable.length; index++) {
    const root = findRoot(parents, `f:${index}`);
    const entry = members.get(root) ?? { libby: [], fable: [] };
    entry.fable.push(index);
    members.set(root, entry);
  }

  const groups = [...members.values()]
    .map((entry) => {
      const books = [
        ...entry.libby.map((index) => libby[index]!.bookId),
        ...entry.fable.map((index) => fable[index]!.bookId),
      ].sort();
      return {
        groupId: `group:${books.join("|")}`,
        title: libby[entry.libby[0] ?? -1]?.title ?? fable[entry.fable[0] ?? -1]?.title ?? "",
        libby: entry.libby.map((index) => libby[index]!),
        fable: entry.fable.map((index) => fable[index]!),
      } satisfies SnapshotGroup;
    })
    .sort((left, right) => left.groupId.localeCompare(right.groupId, "en"));
  return { groups, conflicts, libby, fable };
}

/**
 * Use this function to compare two normalized values without treating array membership order as a conflict.
 * Inputs: `left` and `right` — ordinary snapshot values.
 * Dependencies: none.
 */
function valuesEqual(left: SnapshotValue, right: SnapshotValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    const leftValues = [...left].sort();
    const rightValues = [...right].sort();
    return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
  }
  return Object.is(left, right);
}

/**
 * Use this function to choose one provider field when a work has multiple editions.
 * Inputs: `fields` — candidate fields from one provider; `provider` — source label for diagnostics.
 * Dependencies: `valuesEqual` and timestamp comparison.
 */
function chooseEditionField(
  fields: SnapshotField[],
  provider: SyncProvider,
): { field?: SnapshotField; conflict?: string } {
  if (!fields.length) return {};
  if (fields.every((field) => valuesEqual(field.value, fields[0]!.value))) return { field: fields[0]! };
  if (fields.every((field) => field.updatedAt)) {
    const sorted = [...fields].sort((left, right) => Date.parse(right.updatedAt!) - Date.parse(left.updatedAt!));
    if (Date.parse(sorted[0]!.updatedAt!) > Date.parse(sorted[1]!.updatedAt!)) return { field: sorted[0]! };
  }
  return { conflict: `Different ${provider} edition values need an explicit resolution.` };
}

/**
 * Use this function to aggregate Libby authoritative status evidence across matched editions.
 * Inputs: `group` — a matched snapshot group; `field` — one Libby authoritative field; `settings` — progress policy.
 * Dependencies: `chooseEditionField`, `SyncSettings.progress`, and validated SnapshotField values.
 */
function aggregateAuthoritative(
  group: SnapshotGroup,
  field: string,
  settings: SyncSettings,
): { field?: SnapshotField; conflict?: string } {
  if (!group.libby.length) return { conflict: `Libby value required for authoritative field ${field}` };
  const candidates = group.libby.flatMap((book) => (book.fields[field] ? [book.fields[field]!] : []));
  if (field === "readingProgress") {
    const values = candidates
      .map((candidate) => candidate.value)
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return { conflict: "Libby reading progress is unknown." };
    if (settings.progress === "choose") {
      if (candidates.every((candidate) => valuesEqual(candidate.value, candidates[0]!.value)))
        return { field: candidates[0]! };
      return { conflict: "Choose a Libby edition before syncing progress." };
    }
    if (settings.progress === "latest") {
      if (candidates.some((candidate) => !candidate.updatedAt)) {
        return { conflict: "Latest progress requires edit timestamps on every edition." };
      }
      const sorted = [...candidates].sort((left, right) => Date.parse(right.updatedAt!) - Date.parse(left.updatedAt!));
      if (sorted.length > 1 && Date.parse(sorted[0]!.updatedAt!) === Date.parse(sorted[1]!.updatedAt!)) {
        return { conflict: "Latest progress has tied edit timestamps; choose an edition." };
      }
      return { field: sorted[0]! };
    }
    return { field: { value: Math.max(...values) } };
  }
  if (field === "checkedOut" || field === "finished") {
    if (candidates.some((candidate) => candidate.value === true)) return { field: { value: true } };
    if (candidates.length === group.libby.length && candidates.every((candidate) => candidate.value === false)) {
      return { field: { value: false } };
    }
    return { conflict: `Libby ${field} evidence is incomplete; false cannot be inferred.` };
  }
  return chooseEditionField(candidates, "libby");
}

/**
 * Use this function to derive Fable's reading status from complete Libby evidence.
 * Inputs: `group` — matched Libby/Fable snapshots; `settings` — progress policy for derived status.
 * Dependencies: `aggregateAuthoritative`.
 */
function deriveReadingStatus(
  group: SnapshotGroup,
  settings: SyncSettings,
): { field?: SnapshotField; conflict?: string } {
  if (!group.libby.length) return { conflict: "Libby evidence is required for reading status." };
  const finished = aggregateAuthoritative(group, "finished", settings);
  const checkedOut = aggregateAuthoritative(group, "checkedOut", settings);
  const progress = aggregateAuthoritative(group, "readingProgress", settings);
  if (finished.conflict || finished.field?.value === undefined)
    return { conflict: finished.conflict ?? "Finished status is unknown." };
  if (finished.field.value === true) return { field: { value: "finished", ...derivedVisibility(group) } };
  const checkedOutValue = checkedOut.field?.value;
  const progressValue = progress.field?.value;
  if (checkedOutValue === false || progressValue === 0) return { field: { value: null, ...derivedVisibility(group) } };
  if (checkedOut.conflict || progress.conflict) {
    return { conflict: checkedOut.conflict ?? progress.conflict ?? "Reading status is unknown." };
  }
  if (checkedOutValue === true && typeof progressValue === "number" && progressValue > 0) {
    return { field: { value: "currently-reading", ...derivedVisibility(group) } };
  }
  return { conflict: "Reading status is unknown because Libby evidence is incomplete." };
}

/**
 * Use this function to carry known Libby privacy metadata onto a derived status field.
 * Inputs: `group` — matched provider snapshots whose status evidence is being aggregated.
 * Dependencies: Libby status field visibility values.
 */
function derivedVisibility(group: SnapshotGroup): { visibility?: SnapshotField["visibility"] } {
  const values = group.libby
    .flatMap((book) => [book.fields.readingProgress, book.fields.checkedOut, book.fields.finished])
    .filter((field): field is SnapshotField => field !== undefined)
    .map((field) => field.visibility);
  if (values.includes("private")) return { visibility: "private" };
  return values.length && values.every((value) => value === "public") ? { visibility: "public" } : {};
}

/**
 * Use this function to resolve a normal field from both providers using timestamps or configured preference.
 * Inputs: `libby` and `fable` — source fields; `settings` — resolved conflict policy.
 * Dependencies: `valuesEqual` and `SyncSettings.conflicts`.
 */
function resolveOrdinaryField(
  libby: SnapshotField | undefined,
  fable: SnapshotField | undefined,
  settings: SyncSettings,
): { value?: SnapshotValue; source?: SyncProvider; conflict?: string } {
  if (!libby && !fable) return {};
  if (!libby) return { value: fable!.value, source: "fable" };
  if (!fable) return { value: libby.value, source: "libby" };
  if (valuesEqual(libby.value, fable.value)) return { value: libby.value, source: "libby" };
  if (libby.updatedAt && fable.updatedAt) {
    const libbyTime = Date.parse(libby.updatedAt);
    const fableTime = Date.parse(fable.updatedAt);
    if (libbyTime > fableTime) return { value: libby.value, source: "libby" };
    if (fableTime > libbyTime) return { value: fable.value, source: "fable" };
  }
  if (settings.conflicts === "libby") return { value: libby.value, source: "libby" };
  if (settings.conflicts === "fable") return { value: fable.value, source: "fable" };
  return { conflict: "Different values require newer edit times or an explicit conflict decision." };
}

/**
 * Use this function to decide whether a metadata field belongs to the configured sync scope.
 * Inputs: `field` — provider field name; `scope` — metadata scope from settings.
 * Dependencies: membership-field classification.
 */
export function isMetadataFieldInScope(field: string, scope: SyncSettings["metadataScope"]): boolean {
  if (AUTHORITATIVE_FIELDS.has(field) || field === "readingStatus") return false;
  if (scope === "all-shared") return true;
  const lower = field.toLowerCase();
  const membership = MEMBERSHIP_FIELDS.has(lower) || lower.endsWith("list") || lower.endsWith("lists");
  if (scope === "lists-tags") return membership || lower === "tag";
  return membership || lower === "tag" || lower === "note" || lower === "notes" || lower === "annotation";
}

/**
 * Use this function to reconcile validated snapshots into rows and matching groups while preserving unknowns.
 * Inputs: `libbyInput` and `fableInput` — untrusted provider arrays; `settingsInput` — optional sync settings.
 * Dependencies: `matchSnapshotGroups`, status aggregation, and timestamp resolution.
 */
export function reconcileSnapshotsDetailed(
  libbyInput: unknown,
  fableInput: unknown,
  settingsInput?: unknown,
): ReconcileResult {
  const settings = resolveSyncSettings(settingsInput === undefined ? {} : settingsInput);
  const matched = matchSnapshotGroups(libbyInput, fableInput, settings.matching);
  const rows: SyncField[] = [];
  for (const group of matched.groups) {
    const bookId = group.libby[0]?.bookId ?? group.fable[0]?.bookId ?? group.groupId;
    const fields = new Set<string>([
      ...group.libby.flatMap((book) => Object.keys(book.fields)),
      ...group.fable.flatMap((book) => Object.keys(book.fields)),
    ]);
    const fableStatus = group.fable.some(
      (book) => book.fields.readingStatus || book.knownFields?.includes("readingStatus"),
    );
    const derivedStatus = group.libby.length ? deriveReadingStatus(group, settings) : {};
    if (fableStatus) fields.add("readingStatus");

    for (const field of [...fields].sort((left, right) => left.localeCompare(right, "en"))) {
      const libbyChoice = AUTHORITATIVE_FIELDS.has(field)
        ? aggregateAuthoritative(group, field, settings)
        : chooseEditionField(
            group.libby.flatMap((book) => (book.fields[field] ? [book.fields[field]!] : [])),
            "libby",
          );
      const fableChoice = chooseEditionField(
        group.fable.flatMap((book) => (book.fields[field] ? [book.fields[field]!] : [])),
        "fable",
      );
      const row: SyncField = { bookId, title: group.title, field, groupId: group.groupId };
      if (libbyChoice.field) row.libby = libbyChoice.field;
      if (fableChoice.field) row.fable = fableChoice.field;
      if (
        field === "readingStatus" &&
        derivedStatus.field?.value === null &&
        row.fable &&
        row.fable.value !== null &&
        row.fable.value !== "currently-reading"
      ) {
        row.conflict = "Known not-reading evidence clears only an existing currently-reading status.";
      } else if (field === "readingStatus" && derivedStatus.field) row.libby = derivedStatus.field;
      if (field === "readingStatus" && derivedStatus.conflict) row.conflict = derivedStatus.conflict;
      if (!row.conflict && libbyChoice.conflict && field !== "readingStatus") row.conflict = libbyChoice.conflict;
      if (!row.conflict && fableChoice.conflict) row.conflict = fableChoice.conflict;

      if (!row.conflict) {
        if (AUTHORITATIVE_FIELDS.has(field) || field === "readingStatus") {
          if (row.libby) {
            row.value = row.libby.value;
            row.source = "libby";
          } else row.conflict = `Libby value required for authoritative field ${field}`;
        } else {
          const resolved = resolveOrdinaryField(row.libby, row.fable, settings);
          if (resolved.source) {
            row.value = resolved.value!;
            row.source = resolved.source;
          } else if (resolved.conflict) row.conflict = resolved.conflict;
        }
      }
      rows.push(row);
    }
  }
  return {
    rows: rows.sort(
      (left, right) => left.bookId.localeCompare(right.bookId, "en") || left.field.localeCompare(right.field, "en"),
    ),
    groups: matched.groups,
    conflicts: matched.conflicts,
    libby: matched.libby,
    fable: matched.fable,
  };
}

/**
 * Use this function to reconcile provider snapshots into deterministic legacy rows and reject ambiguous matches.
 * Inputs: `libby` and `fable` — untrusted provider snapshot arrays; `settings` — optional sync settings.
 * Dependencies: `reconcileSnapshotsDetailed`.
 */
export function reconcileSnapshots(libby: unknown, fable: unknown, settings?: unknown): SyncField[] {
  const result = reconcileSnapshotsDetailed(libby, fable, settings);
  if (result.conflicts.length) throw new Error(result.conflicts.map((conflict) => conflict.message).join(" "));
  return result.rows;
}
