import { Ban, Check, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { isbn13 } from "../../../src/matcher.ts";
import type { SyncField, SyncProvider } from "../../../src/sync.ts";
import { SYNC_FALLBACKS } from "../../../src/sync-config.ts";
import { syncDecisionKey } from "../../../src/sync-plan.ts";
import { LibraryCards } from "../components/LibraryCards.tsx";
import { PastCheckouts } from "../components/PastCheckouts.tsx";
import { BookLine, BookSections, ProgressValue, ReadingStatus, Stars } from "../components/SyncBook.tsx";
import { APP_NAMES, AppValue, SyncChange } from "../components/SyncChange.tsx";
import { copyAndOpen, FableReview, type PostReview } from "../components/SyncReview.tsx";
import { SyncSettingsPanel } from "../components/SyncSettings.tsx";
import { compact, Empty, Panel, RefreshButton, Screen } from "../components/ui.tsx";
import { labelForAction } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";
import { type BookSummary, hasValue, LINE_FIELDS, summarizeBooks, toStatusKey } from "../lib/sync-books.ts";
import { displaySyncValue as displayValue, SYNC_FIELD_LABELS as labels } from "../lib/sync-format.ts";
import { useResource } from "../lib/use-resource.ts";
import { useSync } from "../lib/use-sync.ts";

const TABS = ["Shelf", "Library", "Settings"] as const;
const DAY_MS = 86_400_000;

export { toStatusKey } from "../lib/sync-books.ts";
export { summarizeSyncResult } from "../lib/sync-state.ts";

/** Use this function to say how long a loan ending at `expiresAt` has left, counting whole days from `now`. */
export function loanTimeLeft(expiresAt: string | undefined, now = Date.now()): string | undefined {
  const end = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(end)) return undefined;
  const days = Math.ceil((end - now) / DAY_MS);
  return days <= 0 ? "Due today" : days === 1 ? "1 day left" : `${days} days left`;
}
/** Use this function to extract an ISBN from a book snapshot or its provider identifier. Inputs: `book` — snapshot identifiers. Dependencies: None. */
export function extractIsbn(book: {
  isbn?: string | undefined;
  bookId?: string | undefined;
  workId?: string | undefined;
}): string | undefined {
  if (book.isbn) return book.isbn;
  if (book.bookId?.toLowerCase().startsWith("isbn:")) return book.bookId.slice(5);
  if (book.workId?.toLowerCase().startsWith("isbn:")) return book.workId.slice(5);
  return undefined;
}

/** Use this function to normalize ISBN-10 or ISBN-13 values before exact edition matching. Inputs: `isbn` — raw ISBN text. Dependencies: `isbn13`. */
export function normalizeIsbn(isbn?: string): string | undefined {
  return isbn ? isbn13(isbn) : undefined;
}

/** Use this function to identify an exact ISBN match among candidate editions. Inputs: `book` — source snapshot; `candidates` — possible editions. Dependencies: `extractIsbn`, `normalizeIsbn`. */
export function hasExactIsbnMatch(
  book: { isbn?: string | undefined; bookId?: string | undefined; workId?: string | undefined },
  candidates: Array<{ isbn?: string | undefined; bookId?: string | undefined; workId?: string | undefined }>,
): boolean {
  const bookIsbn = normalizeIsbn(extractIsbn(book));
  return Boolean(bookIsbn && candidates.some((candidate) => normalizeIsbn(extractIsbn(candidate)) === bookIsbn));
}

/** Use this screen to compare Libby and Fable through the store's API and retain the last successful reconciliation in the store. */
export function SyncScreen({
  openLoan,
  postReview = copyAndOpen,
  compactLayout = false,
}: {
  openLoan?: (url: string) => Promise<void>;
  /** Take a review to the book's Fable page; outside the extension it is copied and the page opens. */
  postReview?: PostReview;
  compactLayout?: boolean;
} = {}) {
  const {
    api,
    syncResult,
    busy,
    error,
    review,
    settings,
    saved,
    saveSettings,
    sync,
    toggleReview,
    apply,
    remaining,
    visibleOperations,
    missingApproval,
    selectOperations,
    operations,
    outcomeOf,
    resultSummary,
    setError,
  } = useSync();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Shelf");
  const { cards, cardsLoading, reviewDrafts, setReviewDraft } = useStore();
  const libbyConnected = Boolean(syncResult?.plan.schemas.libby.length);
  const comparedAt = syncResult?.comparedAt;
  // Past checkouts follow the Shelf: each successful comparison reloads them, and they belong to one Libby account.
  const libbyAccount = cards
    .map((card) => card.cardId)
    .sort()
    .join(",");
  const loadPastCheckouts = useCallback(
    async () =>
      libbyConnected && comparedAt && !cardsLoading
        ? { account: libbyAccount, value: await api.pastCheckouts() }
        : undefined,
    [api, libbyConnected, comparedAt, libbyAccount, cardsLoading],
  );
  const past = useResource(loadPastCheckouts, { keepStale: true });
  const pastCheckouts = past.data?.account === libbyAccount ? past.data.value : undefined;

  /** Use this function to show one app's side of a conflict; ordinary metadata sides are buttons that resolve the conflict with a new preview, while Libby-authoritative fields cannot be overridden. */
  function conflictSide(row: SyncField, provider: SyncProvider) {
    const field = row[provider];
    if (!field) return null;
    const value = <AppValue provider={provider} value={field.value} field={row.field} updatedAt={field.updatedAt} />;
    if (["readingProgress", "checkedOut", "finished", "readingStatus"].includes(row.field)) return value;
    return (
      <button
        type="button"
        className="cursor-pointer rounded-field px-1 underline decoration-dotted hover:bg-base-200 disabled:cursor-default"
        disabled={busy || !saved}
        aria-label={`Use ${APP_NAMES[provider]} ${labels[row.field] ?? row.field} for ${row.title}`}
        onClick={() =>
          sync({
            ...syncResult?.plan.options,
            resolutions: { ...syncResult?.plan.options.resolutions, [syncDecisionKey(row)]: provider },
          })
        }
      >
        {value}
      </button>
    );
  }

  /** Use this function to show one field in a book's pulldown: its current value, or both apps' values to choose from. */
  function fieldDetail(row: SyncField) {
    return (
      <li key={row.field} className="flex flex-wrap items-center gap-x-2 py-1.5">
        <span className="capitalize">{labels[row.field] ?? row.field}:</span>
        {row.conflict ? (
          <>
            {conflictSide(row, "libby")}
            <span className="opacity-60" title={row.conflict}>
              or
            </span>
            {conflictSide(row, "fable")}
          </>
        ) : (
          <span className="min-w-0 break-words">{displayValue(row.value, row.field)}</span>
        )}
      </li>
    );
  }

  /** Use this function to show "Review" in a line cell whose field has no current value; the reason shows on hover. */
  function lineCell(book: BookSummary, field: string) {
    const row = book.rows.find((candidate) => candidate.field === field && candidate.conflict);
    return (
      row && (
        <span className="text-sm opacity-60" title={row.conflict}>
          Review
        </span>
      )
    );
  }

  const pendingGroups = new Set(operations.filter((op) => outcomeOf(op.id) !== "success").map((op) => op.groupId));
  const bookGroups = new Map(syncResult?.plan.groups.map((group) => [group.groupId, group]));
  const matchReviewIds = new Set(
    syncResult?.plan.schemas.fable.length ? syncResult.plan.conflicts.flatMap((conflict) => conflict.libbyBookIds) : [],
  );
  const books = summarizeBooks(syncResult?.rows ?? []);
  for (const book of books) {
    if (
      bookGroups.get(book.groupId)?.libby.some((entry) => matchReviewIds.has(entry.bookId)) ||
      book.rows.some((row) => row.conflict && row.libby && row.fable)
    )
      pendingGroups.add(book.groupId);
  }
  const shelfBooks = books.filter((book) => book.checkedOut || pendingGroups.has(book.groupId));
  const returnedBooks = new Map(syncResult?.plan.pendingReturned?.map((book) => [`returned:${book.bookId}`, book]));
  for (const [groupId, book] of returnedBooks) {
    shelfBooks.push({
      groupId,
      title: book.title,
      checkedOut: false,
      progress: book.progress,
      status: book.progress === 100 ? "finished" : book.progress ? "progress" : "unopened",
      rows: [],
    });
  }
  const formatLabels = { audiobook: "Audiobook", ebook: "Ebook", print: "Physical book", magazine: "Magazine" };
  /** Use this function to label a match-picker `edition` with its title, format, and any author and ISBN. Inputs: `edition` — candidate edition metadata. Dependencies: `formatLabels`. */
  const formatEdition = (edition: {
    title: string;
    subtitle?: string | undefined;
    author?: string | undefined;
    isbn?: string | undefined;
    format?: keyof typeof formatLabels | undefined;
  }) =>
    [
      edition.title,
      edition.subtitle,
      edition.author && `by ${edition.author}`,
      edition.format ? formatLabels[edition.format] : "Format unknown",
      edition.isbn && `ISBN ${edition.isbn}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const catalogMatches = syncResult?.plan.catalogMatches ?? {};
  const catalogSelections = syncResult?.plan.options.catalogSelections ?? {};
  const matchBookIds = syncResult
    ? [
        ...new Set([
          ...syncResult.plan.conflicts.flatMap((conflict) => conflict.libbyBookIds),
          ...Object.keys(syncResult.plan.options.matches ?? {}),
          ...Object.keys(catalogSelections),
          ...Object.keys(catalogMatches).filter((bookId) => {
            const results = catalogMatches[bookId];
            return results === null || (results?.length ?? 0) > 0;
          }),
        ]),
      ]
    : [];

  return (
    <Screen
      id="sync"
      hideTitle
      compactLayout={compactLayout}
      actions={
        tab === "Shelf" && (
          <div className={`flex flex-wrap ${compactLayout ? "gap-2" : "gap-3"}`}>
            <RefreshButton
              className={`btn btn-primary btn-pop ${compactLayout ? "btn-sm" : "btn-lg"}`}
              busy={busy}
              disabled={!saved}
              onClick={() => void sync()}
            >
              {busy ? (
                <span className="loading loading-spinner" />
              ) : (
                <RefreshCw className={compactLayout ? "size-4" : "size-5"} />
              )}
              {labelForAction("sync", "sync-preview", "Sync")}
            </RefreshButton>
            <button
              type="button"
              className={`btn btn-secondary btn-pop ${compactLayout ? "btn-sm" : "btn-lg"}`}
              disabled={busy || !saved || !remaining.length || missingApproval}
              onClick={apply}
            >
              {api.demo ? "Apply demo changes" : "Apply selected changes"}
            </button>
          </div>
        )
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          className={`tabs tabs-box w-fit font-display font-semibold ${compactLayout ? "" : "tabs-lg"}`}
        >
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`tab ${tab === name ? "tab-active" : ""}`}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {!compactLayout && tab !== "Settings" && (
          <p className="text-sm font-semibold">
            <span className="text-libby">Libby</span> · <span className="text-fable">Fable</span>
          </p>
        )}
      </div>
      {busy ? (
        <p role="status" className={`alert alert-info border-2 border-pop ${compactLayout ? "px-2 py-1 text-xs" : ""}`}>
          Fetching library changes…
        </p>
      ) : error ? (
        <div
          role="alert"
          className={`alert alert-error border-2 border-pop ${compactLayout ? "px-2 py-1 text-xs" : ""}`}
        >
          <span>
            <strong>Fail</strong> — {error}
            {syncResult ? ". The previous comparison is shown below." : ""}
          </span>
        </div>
      ) : (
        resultSummary && (
          <p
            role={resultSummary.status === "Success" ? "status" : "alert"}
            className={`alert border-2 border-pop ${resultSummary.status === "Success" ? "alert-success" : "alert-error"} ${compactLayout ? "px-2 py-1 text-xs" : ""}`}
          >
            {resultSummary.status === "Success" ? (
              <CircleCheck className="size-5" aria-hidden="true" />
            ) : (
              <CircleX className="size-5" aria-hidden="true" />
            )}
            <span>
              <strong>{resultSummary.status}</strong> — {resultSummary.summary}
            </span>
          </p>
        )
      )}
      {tab === "Settings" ? (
        <div
          role="tabpanel"
          aria-label="Settings"
          className={compactLayout ? "space-y-2" : compact ? "space-y-4" : "space-y-6"}
        >
          <SyncSettingsPanel
            value={settings ?? SYNC_FALLBACKS}
            busy={busy || !saved}
            onChange={(value) => saveSettings(value)}
            onReset={() => saveSettings({})}
          />
          <LibraryCards />
        </div>
      ) : busy ? (
        <Empty icon={<RefreshCw className="size-7" />} title="Fetching library changes">
          <p className="max-w-sm text-center text-sm opacity-70">
            Your previous comparison will return when fetching finishes.
          </p>
        </Empty>
      ) : syncResult && tab === "Library" ? (
        <div role="tabpanel" aria-label="Library" className="contents">
          <Panel title="Library">
            <BookSections
              books={books}
              render={(book) => {
                const details = book.rows.filter((row) =>
                  row.conflict
                    ? !["checkedOut", "finished"].includes(row.field)
                    : !LINE_FIELDS.has(row.field) && hasValue(row.value),
                );
                return (
                  <BookLine
                    key={book.groupId}
                    book={book}
                    progressCell={lineCell(book, "readingProgress")}
                    ratingCell={lineCell(book, "rating")}
                    statusCell={lineCell(book, "readingStatus")}
                    details={details.length ? details.map(fieldDetail) : undefined}
                    open={details.some((row) => row.conflict)}
                  />
                );
              }}
            />
          </Panel>
        </div>
      ) : syncResult ? (
        <div role="tabpanel" aria-label="Shelf" className="contents">
          <p role="status" className="text-sm opacity-70">
            {new Set(syncResult.rows.map((row) => row.bookId)).size} books · {syncResult.rows.length} fields ·{" "}
            {syncResult.rows.filter((row) => row.conflict).length} need review
            <span className="mt-1 block">
              Last compared:{" "}
              <time dateTime={syncResult.comparedAt}>{new Date(syncResult.comparedAt).toLocaleString()}</time>
            </span>
            {(["libby", "fable"] as const)
              .filter((provider) => !syncResult.plan.schemas[provider].length)
              .map((provider) => (
                <span key={provider} className="mt-1 block">
                  {APP_NAMES[provider]} is not connected.
                </span>
              ))}
          </p>
          {matchBookIds.length > 0 && (
            <Panel title="Unsynced Checkouts">
              <div className="space-y-3">
                {matchBookIds.map((bookId) => {
                  const book = syncResult.plan.snapshots.libby.find((candidate) => candidate.bookId === bookId);
                  if (!book) return null;
                  const selectedLibrary = syncResult.plan.options.matches?.[bookId];
                  const selectedCatalog = catalogSelections[bookId];
                  const automaticAdd =
                    !selectedCatalog &&
                    syncResult.plan.operations.some(
                      (operation) => operation.bookId === bookId && operation.create?.catalogId,
                    );
                  const libraryIds = new Set(
                    syncResult.plan.conflicts
                      .filter((conflict) => conflict.libbyBookIds.includes(bookId))
                      .flatMap((conflict) => conflict.fableBookIds),
                  );
                  const libraryCandidates = syncResult.plan.snapshots.fable.filter(
                    (candidate) => libraryIds.has(candidate.bookId) || candidate.bookId === selectedLibrary,
                  );
                  const catalogResult = catalogMatches[bookId];
                  const catalogCandidates = (catalogResult ?? []).filter(
                    (candidate) => !syncResult.plan.snapshots.fable.some((saved) => saved.providerId === candidate.id),
                  );
                  const selected = selectedLibrary
                    ? `library:${selectedLibrary}`
                    : selectedCatalog
                      ? `catalog:${selectedCatalog}`
                      : "";
                  const hasChoice =
                    libraryCandidates.length > 0 ||
                    catalogCandidates.length > 0 ||
                    !!(selectedLibrary || selectedCatalog);
                  const noCatalogResult =
                    catalogResult === null
                      ? "Fable catalog lookup failed. Preview again to retry."
                      : "No matching Fable editions";
                  const hasExactIsbn = hasExactIsbnMatch(book, [...libraryCandidates, ...(catalogResult ?? [])]);
                  if (hasExactIsbn) {
                    return (
                      <div key={bookId} className="grid grid-cols-[auto_1fr] items-start gap-x-2 text-sm font-semibold">
                        <div className="pt-0.5 text-success">
                          <Check className="size-4" role="img" aria-label="Exact ISBN match" />
                        </div>
                        <div className="min-w-0">
                          <span>
                            Match {book.title} by {book.author ?? "Unknown author"}
                            {book.format && ` · ${formatLabels[book.format]}`}
                            {book.isbn && ` · ISBN ${book.isbn}`}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <label key={bookId} className="flex flex-col gap-2 text-sm font-semibold">
                      <span>
                        Match {book.title} by {book.author ?? "Unknown author"}
                        {book.format && ` · ${formatLabels[book.format]}`}
                        {book.isbn && ` · ISBN ${book.isbn}`}
                      </span>
                      <select
                        className="select w-full"
                        aria-label={`Match ${book.title}`}
                        value={selected}
                        disabled={busy || !saved || !hasChoice}
                        onChange={(event) => {
                          const { [bookId]: _previousMatch, ...otherMatches } = syncResult.plan.options.matches ?? {};
                          const { [bookId]: _previousCatalog, ...otherCatalogSelections } = catalogSelections;
                          const choice = event.target.value;
                          void sync({
                            ...syncResult.plan.options,
                            matches: otherMatches,
                            catalogSelections: otherCatalogSelections,
                            ...(choice.startsWith("library:")
                              ? { matches: { ...otherMatches, [bookId]: choice.slice("library:".length) } }
                              : choice.startsWith("catalog:")
                                ? {
                                    catalogSelections: {
                                      ...otherCatalogSelections,
                                      [bookId]: choice.slice("catalog:".length),
                                    },
                                  }
                                : {}),
                          });
                        }}
                      >
                        <option value="">
                          {automaticAdd ? "Use suggested edition" : hasChoice ? "Leave unmatched" : noCatalogResult}
                        </option>
                        {libraryCandidates.length > 0 && (
                          <optgroup label="Fable library">
                            {libraryCandidates.map((candidate) => (
                              <option key={`library:${candidate.bookId}`} value={`library:${candidate.bookId}`}>
                                {formatEdition(candidate)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {catalogCandidates.length > 0 && (
                          <optgroup label="Fable catalog">
                            {catalogCandidates.map((candidate) => (
                              <option key={`catalog:${candidate.id}`} value={`catalog:${candidate.id}`}>
                                {formatEdition(candidate)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {hasChoice && catalogResult === null && <span className="font-normal">{noCatalogResult}</span>}
                    </label>
                  );
                })}
              </div>
            </Panel>
          )}
          {settings?.progress === "choose" && syncResult.plan.groups.some((group) => group.libby.length > 1) && (
            <Panel title="Choose progress editions">
              <div className="space-y-3">
                {syncResult.plan.groups
                  .filter((group) => group.libby.length > 1)
                  .map((group) => (
                    <label key={group.groupId} className="flex flex-col gap-2 text-sm font-semibold">
                      <span>Progress edition for {group.title}</span>
                      <select
                        aria-label={`Progress edition for ${group.title}`}
                        className="select w-full"
                        disabled={busy || !saved}
                        value={syncResult.plan.options.editions?.[group.groupId] ?? ""}
                        onChange={(event) =>
                          sync({
                            ...syncResult.plan.options,
                            editions: { ...syncResult.plan.options.editions, [group.groupId]: event.target.value },
                          })
                        }
                      >
                        <option value="">Choose an edition</option>
                        {group.libby.map((book, index) => (
                          <option key={book.bookId} value={book.bookId}>
                            Edition {index + 1}: {displayValue(book.fields.readingProgress?.value, "readingProgress")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
            </Panel>
          )}
          <Panel>
            {syncResult.plan.operations.some((operation) => operation.removal) && (
              <div className="alert alert-error mb-4">
                <strong>
                  REMOVALS: some changes clear fields or remove memberships. They are never applied without explicit
                  review.
                </strong>
              </div>
            )}
            {!shelfBooks.some((book) => book.checkedOut) && (
              <p>{syncResult.plan.schemas.libby.length ? "Nothing checked out" : "Connect Libby to see your Shelf."}</p>
            )}
            <BookSections
              books={shelfBooks}
              pending
              afterCheckedOut={
                libbyConnected && (
                  <PastCheckouts
                    data={pastCheckouts}
                    error={past.error}
                    loading={(past.loading || cardsLoading) && !pastCheckouts}
                    reload={past.reload}
                    checkedOut={
                      new Set(
                        syncResult.plan.snapshots.libby.flatMap((book) => (book.providerId ? [book.providerId] : [])),
                      )
                    }
                    fable={syncResult.plan.snapshots.fable}
                  />
                )
              }
              render={(book) => {
                const retained = returnedBooks.has(book.groupId);
                const bookOperations = visibleOperations.filter((operation) => operation.groupId === book.groupId);
                const lineOperations = bookOperations.filter(
                  (operation) => LINE_FIELDS.has(operation.field) && !operation.removal && !operation.blocked,
                );
                // Progress shows on the line, so its change never repeats in the pulldown.
                const progress = bookOperations.find(
                  (operation) => operation.field === "readingProgress" && !operation.removal,
                );
                const detailOperations = bookOperations.filter(
                  (operation) => !lineOperations.includes(operation) && operation !== progress,
                );
                const selectable = lineOperations.filter(
                  (operation) => !operation.blocked && outcomeOf(operation.id) !== "success",
                );
                const progressOutcome = progress && outcomeOf(progress.id);
                const progressSynced = progressOutcome === "success";
                // The progress row stays out of the pulldown, so its blocked reason or failure shows by the change.
                const progressNote = progress?.blocked ? (
                  <span
                    className="inline-flex items-center gap-0.5 text-xs font-semibold text-warning"
                    title={`Blocked: ${progress.blocked}`}
                  >
                    <Ban className="size-3.5 shrink-0" aria-hidden="true" />
                    Blocked<span className="sr-only">: {progress.blocked}</span>
                  </span>
                ) : progressOutcome && progressOutcome !== "success" ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-error">
                    <CircleX className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="capitalize">{progressOutcome}</span>
                  </span>
                ) : undefined;
                const before = progress?.before?.value;
                const group = bookGroups.get(book.groupId);
                const loans = book.checkedOut ? (group?.libby ?? []) : [];
                const loan = loans.find((entry) => entry.loanUrl)?.loanUrl;
                const fablePage = group?.fable.find((entry) => entry.pageUrl)?.pageUrl;
                const author = [...(group?.libby ?? []), ...(group?.fable ?? [])].find((entry) => entry.author)?.author;
                const narrators = [...new Set(loans.flatMap((entry) => entry.narrators ?? []))];
                const expiresAt = loans
                  .flatMap((entry) => (entry.expiresAt ? [entry.expiresAt] : []))
                  .sort()
                  .at(-1);
                const byline = [
                  author,
                  narrators.length ? `Narrated by ${narrators.join(", ")}` : undefined,
                  loanTimeLeft(expiresAt),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const conflictingFields = book.rows.filter(
                  (row) => row.conflict && row.libby && row.fable && row.field !== "readingProgress",
                );
                const ratingOp = bookOperations.find((operation) => operation.field === "rating");
                const beforeRating = typeof ratingOp?.before?.value === "number" ? ratingOp.before.value : undefined;
                const afterRating = typeof ratingOp?.after === "number" ? ratingOp.after : undefined;
                const hasRatingChange =
                  ratingOp !== undefined && afterRating !== undefined && afterRating !== beforeRating;
                const ratingCell = hasRatingChange ? (
                  <span className="inline-flex items-center gap-1 sm:text-lg">
                    {beforeRating !== undefined && <Stars value={beforeRating} />}
                    <span className="opacity-60 text-xs">→</span>
                    <Stars value={afterRating} />
                  </span>
                ) : undefined;
                const statusOp = bookOperations.find(
                  (operation) => operation.field === "readingStatus" || operation.field === "finished",
                );
                let beforeStatus: "unopened" | "progress" | "dnf" | "finished" | undefined;
                let afterStatus: "unopened" | "progress" | "dnf" | "finished" | undefined;
                if (statusOp) {
                  if (statusOp.field === "readingStatus") {
                    beforeStatus = toStatusKey(statusOp.before?.value) ?? book.status;
                    afterStatus = toStatusKey(statusOp.after);
                  } else if (statusOp.field === "finished") {
                    if (statusOp.after === true) {
                      afterStatus = "finished";
                      beforeStatus =
                        toStatusKey(statusOp.before?.value) ?? (book.status === "finished" ? "progress" : book.status);
                    } else if (statusOp.after === false) {
                      afterStatus = "progress";
                      beforeStatus = "finished";
                    }
                  }
                }
                const hasStatusChange = Boolean(
                  afterStatus !== undefined && beforeStatus !== undefined && afterStatus !== beforeStatus,
                );
                const statusCell =
                  hasStatusChange && beforeStatus && afterStatus ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <ReadingStatus status={beforeStatus} />
                      <span className="opacity-60 text-xs">→</span>
                      <ReadingStatus status={afterStatus} />
                    </span>
                  ) : undefined;
                // After a successful sync the line shows the new progress and no change.
                const progressCell =
                  (book.progress === undefined || progressSynced) && typeof progress?.after === "number" ? (
                    <ProgressValue value={progress.after} />
                  ) : undefined;
                const reviewBox = fablePage && !retained && (
                  <FableReview
                    key="review"
                    title={book.title}
                    pageUrl={fablePage}
                    post={postReview}
                    draft={reviewDrafts[fablePage] ?? ""}
                    onDraft={(text) => setReviewDraft(fablePage, text)}
                  />
                );
                const links = (openLoan && loan) || fablePage;
                return (
                  <BookLine
                    key={book.groupId}
                    book={book}
                    byline={byline || undefined}
                    pending={retained || pendingGroups.has(book.groupId)}
                    action={
                      retained ? (
                        <p className="pb-2 text-sm opacity-70">
                          Last seen on your Shelf. Sync is unavailable after return.
                        </p>
                      ) : links ? (
                        <div className="flex flex-wrap items-center gap-x-3 pb-2 text-sm">
                          {openLoan && loan && (
                            <button
                              type="button"
                              className="link"
                              onClick={() => void openLoan(loan).catch((failure) => setError(String(failure)))}
                            >
                              Open in Libby<span className="sr-only">: {book.title}</span>
                            </button>
                          )}
                          {fablePage && (
                            <a className="link" href={fablePage} target="_blank" rel="noreferrer">
                              Open in Fable<span className="sr-only">: {book.title}</span>
                            </a>
                          )}
                        </div>
                      ) : undefined
                    }
                    progressCell={progressCell}
                    progressChange={
                      typeof progress?.after === "number" && !progressSynced
                        ? progress.after - (typeof before === "number" ? before : 0)
                        : undefined
                    }
                    progressNote={progressNote}
                    ratingCell={ratingCell}
                    statusCell={statusCell}
                    lead={
                      <>
                        {selectable.length > 0 && (
                          <input
                            type="checkbox"
                            className="checkbox checkbox-primary checkbox-sm"
                            aria-label={`Apply changes for ${book.title}`}
                            checked={
                              selectable.length > 0 &&
                              selectable.every((operation) => review.selected.includes(operation.id))
                            }
                            disabled={busy || !saved || !selectable.length}
                            onChange={(event) =>
                              selectOperations(
                                selectable.map((operation) => operation.id),
                                event.target.checked,
                              )
                            }
                          />
                        )}
                        {lineOperations.length > 0 &&
                          lineOperations.every((operation) => outcomeOf(operation.id) === "success") && (
                            <CircleCheck className="size-4 shrink-0 text-success" role="img" aria-label="Applied" />
                          )}
                      </>
                    }
                    details={
                      detailOperations.length || conflictingFields.length || reviewBox
                        ? [
                            reviewBox,
                            ...conflictingFields.map(fieldDetail),
                            ...detailOperations.map((operation) => (
                              <SyncChange
                                key={operation.id}
                                operation={operation}
                                disabled={busy || !saved}
                                selected={review.selected.includes(operation.id)}
                                removalApproved={review.removals.includes(operation.id)}
                                outcome={outcomeOf(operation.id)}
                                onSelect={(value) => toggleReview("selected", operation.id, value)}
                                onRemoval={(value) => toggleReview("removals", operation.id, value)}
                              />
                            )),
                          ]
                        : undefined
                    }
                    open={detailOperations.some((operation) => operation.removal)}
                  />
                );
              }}
            />
          </Panel>
        </div>
      ) : (
        <Empty icon={<RefreshCw className="size-7" />} title="Compare your libraries">
          <p className="max-w-sm text-center text-sm opacity-70">
            See which source wins for each field before making any account changes.
          </p>
        </Empty>
      )}
    </Screen>
  );
}
