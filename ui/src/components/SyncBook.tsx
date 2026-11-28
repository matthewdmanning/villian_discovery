import { ChevronDown } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext } from "react";
import type { BookSummary, StatusKey } from "../lib/sync-books.ts";

const STATUSES = {
  unopened: { label: "Unopened", className: "text-status-unopened" },
  progress: { label: "In Progress", className: "text-status-progress" },
  dnf: { label: "DNF", className: "text-status-dnf" },
  finished: { label: "Finished", className: "text-status-finished" },
} as const;
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
export function ProgressValue({ value }: { value: number }) {
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

/** Use this component to list checked-out books first. Pass `pending` when the second section only has unsynced books; `afterCheckedOut` goes right below the checkouts. */
export function BookSections({
  books,
  pending = false,
  afterCheckedOut,
  render,
}: {
  books: BookSummary[];
  pending?: boolean;
  afterCheckedOut?: ReactNode;
  render(book: BookSummary): ReactNode;
}) {
  const columns = {
    progress: books.some((book) => fills(book, "progress")),
    rating: books.some((book) => fills(book, "rating")),
  };
  return (
    <ColumnsContext.Provider value={columns}>
      <div className="space-y-4">
        {[
          ["Checked out", books.filter((book) => book.checkedOut)] as const,
          [pending ? "Pending sync" : "Not checked out", books.filter((book) => !book.checkedOut)] as const,
        ].map(([title, section]) => (
          <Fragment key={title}>
            {section.length > 0 && (
              <section aria-label={title}>
                <h2 className="font-display text-xl font-bold">{title}</h2>
                {title === "Pending sync" && <p className="text-sm opacity-70">No longer checked out</p>}
                <ul className={pending ? "space-y-1" : "divide-y divide-base-300"}>{section.map(render)}</ul>
              </section>
            )}
            {title === "Checked out" && afterCheckedOut}
          </Fragment>
        ))}
      </div>
    </ColumnsContext.Provider>
  );
}

/** Use this component to show one book on a single line; when `details` exist, the line opens a pulldown marked by an arrow at the far right. `pending` true marks unsynced changes in yellow; false mutes a synced book. */
export function BookLine({
  book,
  byline,
  lead,
  progressChange,
  progressNote,
  progressCell,
  ratingCell,
  statusCell,
  details,
  open,
  pending,
  action,
}: {
  book: BookSummary;
  /** Shown under the title, such as the author, narrators and days left on the loan. */
  byline?: ReactNode;
  lead?: ReactNode;
  progressChange?: number | undefined;
  /** Shown after the progress change, such as why Fable progress cannot be written. */
  progressNote?: ReactNode;
  progressCell?: ReactNode;
  ratingCell?: ReactNode;
  statusCell?: ReactNode;
  details?: ReactNode;
  open?: boolean;
  pending?: boolean | undefined;
  action?: ReactNode;
}) {
  const columns = useContext(ColumnsContext);
  const fields = [
    columns.progress && (
      <span
        key="progress"
        className="inline-flex items-center gap-1 whitespace-nowrap font-sans font-semibold tabular-nums"
      >
        {progressCell ?? (book.progress !== undefined && <ProgressValue value={book.progress} />)}
        {progressChange !== undefined && progressChange !== 0 && (
          <span className="text-xs font-bold text-status-progress">
            {progressChange > 0 ? "+" : ""}
            {progressChange}%
          </span>
        )}
        {progressNote}
      </span>
    ),
    columns.rating && (
      <span key="rating" className="sm:text-lg">
        {ratingCell ?? (book.rating !== undefined && <Stars value={book.rating} />)}
      </span>
    ),
    <span key="status">{statusCell ?? <ReadingStatus status={book.status} />}</span>,
  ].filter(Boolean);
  // Phones wrap the fields under the title; wider screens align them in columns.
  const grid = "flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 sm:grid sm:gap-x-6 sm:gap-y-0";
  const style = {
    gridTemplateColumns: ["minmax(0,2fr)", ...fields.map(() => "minmax(max-content,1fr)"), "1rem"].join(" "),
  };
  const cells = (
    <>
      <span className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
        {lead}
        <span className="min-w-0">
          <span className="block truncate pr-1 font-display text-lg font-semibold italic">
            {book.title}
            {pending && <span className="sr-only"> (needs sync)</span>}
          </span>
          {byline && <span className="block text-xs break-words opacity-75">{byline}</span>}
        </span>
      </span>
      {fields}
    </>
  );
  const highlight =
    pending === true
      ? "rounded-field border-s-4 border-warning bg-warning/10 ps-2"
      : pending === false
        ? "rounded-field border-s-4 border-base-300 bg-base-200/50 ps-2"
        : "";
  if (!details)
    return (
      <li className={highlight}>
        <div className={grid} style={style}>
          {cells}
          <span />
        </div>
        {action}
      </li>
    );
  return (
    <li className={highlight}>
      <details className="group" open={open}>
        <summary className={`${grid} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} style={style}>
          {cells}
          <ChevronDown
            className="ms-auto size-4 transition-transform group-open:rotate-180 sm:ms-0"
            aria-hidden="true"
          />
        </summary>
        <ul className="pb-2 pl-10 text-sm">{details}</ul>
      </details>
      {action}
    </li>
  );
}
