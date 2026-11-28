import { z } from "zod";
import { isbn13, normalizeName, normalizeTitle, titleSimilarity } from "./matcher.js";
import { resolveSyncSettings, type SyncSettings } from "./sync-config.js";

export const SnapshotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
export const SnapshotFieldSchema = z
  .object({
    value: SnapshotValueSchema,
    updatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const BookSnapshotSchema = z
  .object({
    bookId: z.string().min(1),
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    isbn: z.string().min(1).optional(),
    format: z.enum(["audiobook", "ebook", "print", "magazine"]).optional(),
    workId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    loanUrl: z.url({ protocol: /^https$/, hostname: /^libbyapp\.com$/ }).optional(),
    narrators: z.array(z.string().min(1)).optional(),
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
 * Dependencies: `isbn13` from the matcher module.
 */
function isbn13For(book: BookSnapshot): string | undefined {
  const value = book.isbn ?? (book.bookId.toLowerCase().startsWith("isbn:") ? book.bookId.slice(5) : undefined);
  return value ? isbn13(value) : undefined;
}

/**
 * Use this function to list only identities that adapters may verify across providers.
 * Inputs: `book` — a provider snapshot carrying shared work or ISBN identity.
 * Dependencies: `isbn13For`.
 */
function sharedIdentityKeys(book: BookSnapshot): string[] {
  const keys: string[] = [];
  // Format stays out of the key: Fable often omits it. Joins check format compatibility instead.
  if (book.workId) keys.push(`work:${book.workId}`);
  const isbn = isbn13For(book);
  if (isbn) keys.push(`isbn13:${isbn}`);
  return keys;
}

/** An unknown format fits any format; two known formats must be equal. */
export function formatsCompatible(left: BookSnapshot["format"], right: BookSnapshot["format"]): boolean {
  return !left || !right || left === right;
}

/** Use this function to score a candidate edition for a loan. Inputs: `book` — Libby title, format, and ISBN evidence; `candidate` — Fable title, format, ISBN, and optional subtitle. Dependencies: `isbn13` and `titleSimilarity`; incompatible formats have no score. */
export function syncEditionScore(
  book: Pick<BookSnapshot, "title" | "format" | "isbn">,
  candidate: Pick<BookSnapshot, "title" | "format" | "isbn"> & { subtitle?: string },
): number | undefined {
  if (!formatsCompatible(book.format, candidate.format)) return undefined;
  const isbn = book.isbn && isbn13(book.isbn);
  if (isbn && candidate.isbn && isbn === isbn13(candidate.isbn)) return 1;
  return titleSimilarity(
    book.title,
    { id: "", title: candidate.title, ...(candidate.subtitle ? { subtitle: candidate.subtitle } : {}) },
    true,
  );
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
 * Use this function to list union-find roots that already hold books from both providers.
 * Inputs: `parents` — union-find parent map; `libbyCount` and `fableCount` — provider snapshot counts.
 * Dependencies: `findRoot`.
 */
function matchedRoots(parents: Map<string, string>, libbyCount: number, fableCount: number): Set<string> {
  const libbyRoots = new Set<string>();
  for (let index = 0; index < libbyCount; index++) libbyRoots.add(findRoot(parents, `l:${index}`));
  const matched = new Set<string>();
  for (let index = 0; index < fableCount; index++) {
    const root = findRoot(parents, `f:${index}`);
    if (libbyRoots.has(root)) matched.add(root);
  }
  return matched;
}

/**
 * Use this function to join user-confirmed Libby/Fable pairs without letting a confirmation pull unrelated Libby works into one destination.
 * Inputs: `parents` — union-find parent map; `libby` and `fable` — parsed snapshots; `confirmed` — Libby bookId to Fable bookId.
 * Dependencies: `findRoot`, `joinRoots`, `workKey`.
 */
function joinConfirmed(
  parents: Map<string, string>,
  libby: BookSnapshot[],
  fable: BookSnapshot[],
  confirmed: Record<string, string>,
): void {
  const libbyIndex = new Map(libby.map((book, index) => [book.bookId, index]));
  const fableIndex = new Map(fable.map((book, index) => [book.bookId, index]));
  const pairs = Object.entries(confirmed).map(([libbyId, fableId]) => {
    const left = libbyIndex.get(libbyId);
    const right = fableIndex.get(fableId);
    if (left === undefined || right === undefined)
      throw new Error("A confirmed book match no longer exists; review matching again");
    if (syncEditionScore(libby[left]!, fable[right]!) === undefined)
      throw new Error("A confirmed book match uses incompatible formats");
    return { left, right };
  });
  const libbyInRoot = (root: string) => {
    const members: number[] = [];
    for (let index = 0; index < libby.length; index++)
      if (findRoot(parents, `l:${index}`) === root) members.push(index);
    return members;
  };
  const trusted = new Map<number, Set<number>>();
  for (const { right } of pairs)
    if (!trusted.has(right)) trusted.set(right, new Set(libbyInRoot(findRoot(parents, `f:${right}`))));
  for (const { left, right } of pairs) joinRoots(parents, `f:${right}`, `l:${left}`);
  for (const [right, before] of trusted) {
    const members = libbyInRoot(findRoot(parents, `f:${right}`));
    if (members.length < 2) continue;
    const key = workKey(fable[right]!);
    if (!key || members.some((index) => !before.has(index) && workKey(libby[index]!) !== key))
      throw new Error("Confirmed matches cannot collapse unrelated books into one destination");
  }
}

/**
 * Use this function to group snapshots using canonical IDs, verified shared identities, user-confirmed pairs, and optional exact work fallback.
 * Inputs: `libbyInput` and `fableInput` — provider snapshot arrays; `matching` — identifier-only or work policy; `confirmed` — Libby bookId to Fable bookId.
 * Dependencies: `parseSnapshots`, `sharedIdentityKeys`, `joinConfirmed`, `workKey`, and union-find helpers.
 */
export function matchSnapshotGroups(
  libbyInput: unknown,
  fableInput: unknown,
  matching?: SyncSettings["matching"],
  confirmed: Record<string, string> = {},
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
    const formats = [
      ...new Set(
        [
          ...entry.libby.map((index) => libby[index]!.format),
          ...entry.fable.map((index) => fable[index]!.format),
        ].filter((format) => format !== undefined),
      ),
    ];
    // One known format (or none): unknown formats fit, so everything joins. Several: join each format's own
    // editions, and leave books without a format apart, since they could belong to either.
    const buckets =
      formats.length > 1
        ? formats.map((format) => ({
            libby: entry.libby.filter((index) => libby[index]!.format === format),
            fable: entry.fable.filter((index) => fable[index]!.format === format),
          }))
        : [entry];
    for (const bucket of buckets) {
      if (!bucket.libby.length || !bucket.fable.length) continue;
      const firstLibby = bucket.libby[0]!;
      const firstFable = bucket.fable[0]!;
      for (const index of bucket.libby.slice(1)) joinRoots(parents, `l:${firstLibby}`, `l:${index}`);
      for (const index of bucket.fable.slice(1)) joinRoots(parents, `f:${firstFable}`, `f:${index}`);
      joinRoots(parents, `l:${firstLibby}`, `f:${firstFable}`);
    }
  }
  joinConfirmed(parents, libby, fable, confirmed);

  const conflicts: SnapshotMatchConflict[] = [];
  if (matchMode === "work") {
    const workIndex = new Map<string, { libby: number[]; fable: number[] }>();
    const matched = matchedRoots(parents, libby.length, fable.length);
    const addWork = (provider: "libby" | "fable", book: BookSnapshot, index: number): void => {
      if (matched.has(findRoot(parents, `${provider === "libby" ? "l" : "f"}:${index}`))) return;
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
      // Pair a Libby and a Fable book only when each is the other's single format-compatible candidate.
      const fits = (left: number, right: number) => formatsCompatible(libby[left]!.format, fable[right]!.format);
      const ambiguousLibby = new Set<number>();
      const ambiguousFable = new Set<number>();
      for (const left of entry.libby) {
        const candidates = entry.fable.filter((right) => fits(left, right));
        if (!candidates.length) continue;
        const [only] = candidates;
        if (candidates.length === 1 && entry.libby.filter((other) => fits(other, only!)).length === 1) {
          joinRoots(parents, `l:${left}`, `f:${only!}`);
          continue;
        }
        ambiguousLibby.add(left);
        for (const right of candidates) ambiguousFable.add(right);
      }
      if (ambiguousLibby.size)
        conflicts.push({
          code: "ambiguous-match",
          message: "Exact normalized title and author match is ambiguous; choose an edition explicitly.",
          libbyBookIds: [...ambiguousLibby].map((index) => libby[index]!.bookId),
          fableBookIds: [...ambiguousFable].map((index) => fable[index]!.bookId),
        });
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
 * Use this function to combine edition fields that agree on one value, keeping their latest edit time.
 * Inputs: `fields` — non-empty candidate fields sharing the chosen value; `value` — that value.
 * Dependencies: none.
 */
function mergeEvidence(fields: SnapshotField[], value: SnapshotValue): SnapshotField {
  const merged: SnapshotField = { value };
  const times = fields.flatMap((field) => (field.updatedAt ? [field.updatedAt] : []));
  if (times.length)
    merged.updatedAt = times.reduce((left, right) => (Date.parse(right) > Date.parse(left) ? right : left));
  return merged;
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
    const furthest = Math.max(...values);
    return {
      field: mergeEvidence(
        candidates.filter((candidate) => candidate.value === furthest),
        furthest,
      ),
    };
  }
  if (field === "checkedOut" || field === "finished") {
    const yes = candidates.filter((candidate) => candidate.value === true);
    if (yes.length) return { field: mergeEvidence(yes, true) };
    if (candidates.length === group.libby.length && candidates.every((candidate) => candidate.value === false)) {
      return { field: mergeEvidence(candidates, false) };
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
  if (finished.field.value === true) return { field: { value: "finished" } };
  const checkedOutValue = checkedOut.field?.value;
  const progressValue = progress.field?.value;
  if (checkedOutValue === false || progressValue === 0) return { field: { value: null } };
  if (checkedOut.conflict || progress.conflict) {
    return { conflict: checkedOut.conflict ?? progress.conflict ?? "Reading status is unknown." };
  }
  if (checkedOutValue === true && typeof progressValue === "number" && progressValue > 0) {
    return { field: { value: "currently-reading" } };
  }
  return { conflict: "Reading status is unknown because Libby evidence is incomplete." };
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
 * Inputs: `libbyInput` and `fableInput` — untrusted provider arrays; `settingsInput` — optional sync settings; `confirmed` — user-confirmed Libby-to-Fable matches.
 * Dependencies: `matchSnapshotGroups`, status aggregation, and timestamp resolution.
 */
export function reconcileSnapshotsDetailed(
  libbyInput: unknown,
  fableInput: unknown,
  settingsInput?: unknown,
  confirmed?: Record<string, string>,
): ReconcileResult {
  const settings = resolveSyncSettings(settingsInput === undefined ? {} : settingsInput);
  const matched = matchSnapshotGroups(libbyInput, fableInput, settings.matching, confirmed);
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
