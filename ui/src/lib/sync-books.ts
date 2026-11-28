import type { SnapshotValue, SyncField } from "../../../src/sync.ts";

/** Fields shown on a book's single line; every other field opens in the book's pulldown. */
export const LINE_FIELDS = new Set(["readingProgress", "rating", "readingStatus", "checkedOut", "finished"]);

export type StatusKey = "unopened" | "progress" | "dnf" | "finished";

/** Use this function to map provider reading status values to the shelf display status. Inputs: `value` — provider status. Dependencies: None. */
export function toStatusKey(value: unknown): StatusKey | undefined {
  if (value === "finished") return "finished";
  if (value === "currently-reading") return "progress";
  if (value === "dnf" || value === "did-not-finish") return "dnf";
  if (value === "unopened") return "unopened";
  return undefined;
}

export type BookSummary = {
  groupId: string;
  title: string;
  checkedOut: boolean;
  progress?: number | undefined;
  rating?: number | undefined;
  status: StatusKey;
  rows: SyncField[];
};

/** Use this function to tell whether a value holds anything worth showing. */
export function hasValue(value: SnapshotValue | undefined): boolean {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);
}

/** Use this function to reduce one book's reconciled rows to its current progress, rating, reading status, and checked-out state. */
function summarize(rows: SyncField[]): BookSummary {
  const current = (field: string) => {
    const row = rows.find((candidate) => candidate.field === field);
    return row && !row.conflict ? row.value : undefined;
  };
  const progress = current("readingProgress");
  const rating = current("rating");
  const started = typeof progress === "number" && progress > 0;
  const statusValue = current("readingStatus");
  const status: StatusKey =
    statusValue === "finished" || current("finished") === true
      ? "finished"
      : statusValue === "currently-reading" || (statusValue === undefined && current("checkedOut") === true && started)
        ? "progress"
        : statusValue === "dnf" || statusValue === "did-not-finish" || started
          ? "dnf"
          : "unopened";
  return {
    groupId: rows[0]!.groupId ?? rows[0]!.bookId,
    title: rows[0]!.title,
    checkedOut: current("checkedOut") === true,
    progress: typeof progress === "number" ? progress : undefined,
    rating: typeof rating === "number" ? rating : undefined,
    status,
    rows,
  };
}

/** Use this function to group reconciled rows into one summary per book, with checked-out books first. */
export function summarizeBooks(rows: SyncField[]): BookSummary[] {
  const groups = new Map<string, SyncField[]>();
  for (const row of rows) {
    const key = row.groupId ?? row.bookId;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const books = [...groups.values()].map(summarize);
  return [...books.filter((book) => book.checkedOut), ...books.filter((book) => !book.checkedOut)];
}
