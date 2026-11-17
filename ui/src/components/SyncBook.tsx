import { ChevronDown } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import type { SnapshotValue, SyncField } from "../../../src/sync.ts";

/** Fields shown on a book's single line; every other field opens in the book's pulldown. */
export const LINE_FIELDS = new Set(["readingProgress", "rating", "readingStatus", "checkedOut", "finished"]);

const STATUSES = {
  unopened: { label: "Unopened", className: "text-status-unopened" },
  progress: { label: "In Progress", className: "text-status-progress" },
  dnf: { label: "DNF", className: "text-status-dnf" },
  finished: { label: "Finished", className: "text-status-finished" },
} as const;
type StatusKey = keyof typeof STATUSES;

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

/** Use this component to show a 0–5 rating in quarter stars. */
export function Stars({ value }: { value: number }) {
  const quarters = Math.round(Math.min(Math.max(value, 0), 5) * 4) / 4;
  return (
    <span
      className="relative inline-block whitespace-nowrap leading-none"
      role="img"
      aria-label={`${quarters} of 5 stars`}
    >
      <span className="text-base-300">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden text-star" style={{ width: `${(quarters / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/** Use this component to show a reading status in its semantic color. */
export function ReadingStatus({ status }: { status: StatusKey }) {
  return (
    <span className={`whitespace-nowrap font-sans text-sm font-extrabold ${STATUSES[status].className}`}>
      {STATUSES[status].label}
    </span>
  );
}

/** Use this component to show a progress percentage over a small bar filled to that value. */
function ProgressValue({ value }: { value: number }) {
  const percent = Math.min(Math.max(value, 0), 100);
  return (
    <span className="relative inline-block w-14 overflow-hidden rounded-field bg-base-300/60 text-center align-middle">
      <span
        className="absolute inset-y-0 left-0 bg-status-progress/25"
        style={{ width: `${percent}%` }}
        aria-hidden="true"
      />
      <span className="relative">{value}%</span>
    </span>
  );
}

/** Line columns that at least one listed book fills; empty columns are left out of the layout. */
type Columns = { progress: boolean; rating: boolean };
const ColumnsContext = createContext<Columns>({ progress: true, rating: true });

/** Use this function to tell whether a book has a value, or a conflict to review, for one line field. */
function fills(book: BookSummary, field: "progress" | "rating"): boolean {
  const name = field === "progress" ? "readingProgress" : "rating";
  return book[field] !== undefined || book.rows.some((row) => row.field === name && row.conflict);
}

/** Use this component to list books under "Checked out" first, then "Not checked out"; empty sections are omitted. */
export function BookSections({ books, render }: { books: BookSummary[]; render(book: BookSummary): ReactNode }) {
  const columns = {
    progress: books.some((book) => fills(book, "progress")),
    rating: books.some((book) => fills(book, "rating")),
  };
  return (
    <ColumnsContext.Provider value={columns}>
      <div className="space-y-4">
        {[
          ["Checked out", books.filter((book) => book.checkedOut)] as const,
          ["Not checked out", books.filter((book) => !book.checkedOut)] as const,
        ].map(
          ([title, section]) =>
            section.length > 0 && (
              <section key={title} aria-label={title}>
                <h2 className="font-display text-xl font-bold">{title}</h2>
                <ul className="divide-y divide-base-300">{section.map(render)}</ul>
              </section>
            ),
        )}
      </div>
    </ColumnsContext.Provider>
  );
}

/** Use this component to show one book on a single line; when `details` exist, the line opens a pulldown marked by an arrow at the far right. */
export function BookLine({
  book,
  lead,
  progressChange,
  progressCell,
  ratingCell,
  statusCell,
  details,
  open,
}: {
  book: BookSummary;
  lead?: ReactNode;
  progressChange?: number | undefined;
  progressCell?: ReactNode;
  ratingCell?: ReactNode;
  statusCell?: ReactNode;
  details?: ReactNode;
  open?: boolean;
}) {
  const columns = useContext(ColumnsContext);
  const fields = [
    columns.progress && (
      <span key="progress" className="whitespace-nowrap font-sans font-semibold tabular-nums">
        {progressCell ?? (book.progress !== undefined && <ProgressValue value={book.progress} />)}
        {progressChange !== undefined && progressChange !== 0 && (
          <span className="text-sm font-normal opacity-60">
            {" "}
            ({progressChange > 0 ? "+" : ""}
            {progressChange}%)
          </span>
        )}
      </span>
    ),
    columns.rating && (
      <span key="rating" className="sm:text-lg">
        {ratingCell ?? (book.rating !== undefined && <Stars value={book.rating} />)}
      </span>
    ),
    <span key="status">{statusCell ?? <ReadingStatus status={book.status} />}</span>,
  ].filter(Boolean);
  const grid = "grid items-center gap-x-2 py-2.5 sm:gap-x-6";
  const style = {
    gridTemplateColumns: ["minmax(5.5rem,2fr)", ...fields.map(() => "minmax(max-content,1fr)"), "1rem"].join(" "),
  };
  const cells = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {lead}
        <span className="truncate pr-1 font-display text-lg font-semibold italic">{book.title}</span>
      </span>
      {fields}
    </>
  );
  if (!details)
    return (
      <li className={grid} style={style}>
        {cells}
        <span />
      </li>
    );
  return (
    <li>
      <details className="group" open={open}>
        <summary className={`${grid} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} style={style}>
          {cells}
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <ul className="pb-2 pl-10 text-sm">{details}</ul>
      </details>
    </li>
  );
}
