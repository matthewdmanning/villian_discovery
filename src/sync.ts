import { z } from "zod";

const SnapshotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
const SnapshotFieldSchema = z
  .object({
    value: SnapshotValueSchema,
    updatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const BookSnapshotSchema = z
  .object({
    bookId: z.string().min(1),
    title: z.string().min(1),
    fields: z.record(z.string().min(1), SnapshotFieldSchema),
  })
  .strict()
  .superRefine((book, ctx) => {
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

export type SyncField = {
  bookId: string;
  title: string;
  field: string;
  libby?: SnapshotField;
  fable?: SnapshotField;
  value?: SnapshotField["value"];
  source?: "libby" | "fable";
  conflict?: string;
};

const AUTHORITATIVE_FIELDS = new Set(["readingProgress", "checkedOut", "finished"]);

/** Use this function to validate one provider's snapshots and reject duplicate canonical book IDs. */
function parseSnapshots(input: unknown, provider: "Libby" | "Fable"): BookSnapshot[] {
  const snapshots = z.array(BookSnapshotSchema).parse(input);
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.bookId)) throw new Error(`Duplicate bookId in ${provider} snapshots: ${snapshot.bookId}`);
    seen.add(snapshot.bookId);
  }
  return snapshots;
}

/** Use this function to reconcile validated Libby and Fable snapshots into deterministic field rows. */
export function reconcileSnapshots(libby: unknown, fable: unknown): SyncField[] {
  const libbyBooks = parseSnapshots(libby, "Libby");
  const fableBooks = parseSnapshots(fable, "Fable");
  const books = new Map<string, { libby?: BookSnapshot; fable?: BookSnapshot }>();

  for (const book of libbyBooks) books.set(book.bookId, { libby: book });
  for (const book of fableBooks) books.set(book.bookId, { ...books.get(book.bookId), fable: book });

  const rows: SyncField[] = [];
  for (const [bookId, pair] of books) {
    const fields = new Set([...Object.keys(pair.libby?.fields ?? {}), ...Object.keys(pair.fable?.fields ?? {})]);
    const title = pair.libby?.title ?? pair.fable?.title ?? "";

    for (const field of fields) {
      const libbyField = pair.libby?.fields[field];
      const fableField = pair.fable?.fields[field];
      if (!libbyField && !fableField) continue;

      const row: SyncField = { bookId, title, field };
      if (libbyField) row.libby = libbyField;
      if (fableField) row.fable = fableField;

      if (AUTHORITATIVE_FIELDS.has(field)) {
        if (libbyField) {
          row.value = libbyField.value;
          row.source = "libby";
        } else {
          row.conflict = "Libby value required for authoritative field";
        }
      } else if (!libbyField) {
        row.value = fableField!.value;
        row.source = "fable";
      } else if (!fableField) {
        row.value = libbyField.value;
        row.source = "libby";
      } else if (JSON.stringify(libbyField.value) === JSON.stringify(fableField.value)) {
        row.value = libbyField.value;
        row.source = "libby";
      } else if (!libbyField.updatedAt || !fableField.updatedAt) {
        row.conflict = "Different values require both edit timestamps";
      } else if (Date.parse(libbyField.updatedAt) > Date.parse(fableField.updatedAt)) {
        row.value = libbyField.value;
        row.source = "libby";
      } else if (Date.parse(fableField.updatedAt) > Date.parse(libbyField.updatedAt)) {
        row.value = fableField.value;
        row.source = "fable";
      } else {
        row.conflict = "Different values have equal edit timestamps";
      }
      rows.push(row);
    }
  }

  return rows.sort(
    (left, right) => left.bookId.localeCompare(right.bookId, "en") || left.field.localeCompare(right.field, "en"),
  );
}
