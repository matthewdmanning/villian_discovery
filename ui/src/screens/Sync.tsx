import { Ban, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyncField, SyncProvider } from "../../../src/sync.ts";
import { SYNC_FALLBACKS, type SyncSettings } from "../../../src/sync-config.ts";
import {
  type SyncApplyReport,
  type SyncApprovals,
  type SyncPlan,
  type SyncPreviewOptions,
  syncDecisionKey,
} from "../../../src/sync-plan.ts";
import {
  BookLine,
  BookSections,
  type BookSummary,
  hasValue,
  LINE_FIELDS,
  summarizeBooks,
} from "../components/SyncBook.tsx";
import { APP_NAMES, AppValue, isAppConflict, SyncChange } from "../components/SyncChange.tsx";
import { SyncSettingsPanel } from "../components/SyncSettings.tsx";
import { Empty, Panel, Screen } from "../components/ui.tsx";
import { useStore } from "../lib/store.tsx";
import { displaySyncValue as displayValue, SYNC_FIELD_LABELS as labels } from "../lib/sync-format.ts";

const TABS = ["Changes", "Library", "Settings"] as const;

/** Use plan counts, not provider payloads, to describe a completed preview or apply in plain language. */
export function summarizeSyncResult(
  plan: Pick<SyncPlan, "operations">,
  report?: Pick<SyncApplyReport, "outcomes">,
): { status: "Success" | "Fail"; summary: string } {
  if (report) {
    const applied = report.outcomes.filter((outcome) => outcome.status === "success").length;
    const failed = report.outcomes.length - applied;
    if (failed > 0)
      return {
        status: "Fail",
        summary: `${applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}; ` : ""}${failed} change${failed === 1 ? "" : "s"} could not be confirmed. Review the changes and try again.`,
      };
    return {
      status: "Success",
      summary: applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}.` : "No changes were applied.",
    };
  }

  const reviewable = plan.operations.filter((operation) => !operation.blocked).length;
  return {
    status: "Success",
    summary: reviewable
      ? `${reviewable} change${reviewable === 1 ? "" : "s"} found. Review before applying.`
      : plan.operations.length
        ? `${plan.operations.length} change${plan.operations.length === 1 ? "" : "s"} require review before applying.`
        : "No changes needed.",
  };
}

/** Use this screen to compare Libby and Fable through the store's API and retain the last successful reconciliation in the store. */
export function SyncScreen() {
  const {
    api,
    syncResult,
    setSyncResult,
    syncBusy: busy,
    setSyncBusy: setBusy,
    syncError: error,
    setSyncError: setError,
  } = useStore();
  const review: SyncApprovals = syncResult?.review ?? { selected: [], removals: [] };
  const [settings, setSettings] = useState<SyncSettings>();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Changes");
  const saved = settings !== undefined;

  useEffect(() => {
    let active = true;
    setSettings(undefined);
    api.getSyncSettings().then(
      (value) => {
        if (active) setSettings(value);
      },
      (failure) => {
        if (active) {
          setSettings({ ...SYNC_FALLBACKS });
          setError(`Saved settings could not be loaded: ${String(failure)}. Default settings are used.`);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, setError]);

  /** Use this function to save validated user overrides as soon as they change; clearing the result makes the preview run again. An empty object restores the shipped fallback values. */
  async function saveSettings(input: unknown) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSettings(await api.saveSyncSettings(input));
      setSyncResult(undefined);
    } catch (failure) {
      setError(`Settings were not saved: ${String(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Use this function to update the local comparison only after the API completes successfully; errors preserve the previous result. */
  async function sync(options: SyncPreviewOptions = syncResult?.plan.options ?? {}) {
    if (busy || !saved) return;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await api.previewSync(options);
      setSyncResult({
        rows: plan.rows,
        plan,
        comparedAt: new Date().toISOString(),
        review: {
          selected: plan.operations
            .filter((operation) => !operation.blocked && !operation.removal)
            .map((operation) => operation.id),
          removals: [],
        },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  // Compare automatically when Sync opens and after each settings change; a failure waits for "Preview changes".
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads current state; rerun only when these change.
  useEffect(() => {
    if (saved && !syncResult && !busy && !error) void sync();
  }, [saved, syncResult]);

  /** Use this function to record explicit selections and independent risk approvals for this exact preview. */
  function toggleReview(kind: keyof SyncApprovals, id: string, checked: boolean) {
    if (!syncResult) return;
    const previous = syncResult.review;
    setSyncResult({
      ...syncResult,
      review: {
        ...previous,
        [kind]: checked ? [...new Set([...previous[kind], id])] : previous[kind].filter((value) => value !== id),
      },
    });
  }

  /** Use this function to apply only the trusted plan ID and selected approvals; operation outcomes remain visible across navigation. */
  async function apply() {
    if (busy || !saved || !syncResult) return;
    setBusy(true);
    setError(undefined);
    try {
      const report = await api.applySync(syncResult.plan.id, review);
      setSyncResult({ ...syncResult, report });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const remaining =
    syncResult?.plan.operations.filter(
      (operation) =>
        review.selected.includes(operation.id) &&
        !syncResult.report?.outcomes.some(
          (outcome) => outcome.operationId === operation.id && outcome.status === "success",
        ),
    ) ?? [];
  const operations = syncResult?.plan.operations ?? [];
  const visibleOperations = operations
    .filter((operation) => settings?.showNonConflicting === "yes" || isAppConflict(operation) || operation.create)
    .sort((left, right) => Number(right.removal) - Number(left.removal));
  const missingApproval = remaining.some(
    (operation) => operation.blocked || (operation.removal && !review.removals.includes(operation.id)),
  );

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

  /** Use this function to select or clear several operations at once, such as every line change for one book. */
  function selectOperations(ids: string[], checked: boolean) {
    if (!syncResult) return;
    const selected = new Set(syncResult.review.selected);
    for (const id of ids) {
      if (checked) selected.add(id);
      else selected.delete(id);
    }
    setSyncResult({ ...syncResult, review: { ...syncResult.review, selected: [...selected] } });
  }

  const outcomeOf = (id: string) => syncResult?.report?.outcomes.find((outcome) => outcome.operationId === id)?.status;
  const resultSummary = syncResult && summarizeSyncResult(syncResult.plan, syncResult.report);

  return (
    <Screen
      id="sync"
      actions={
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn btn-primary btn-pop btn-lg"
            disabled={busy || !saved}
            onClick={() => sync()}
          >
            {busy ? <span className="loading loading-spinner" /> : <RefreshCw className="size-5" />}
            Preview changes
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-pop btn-lg"
            disabled={busy || !saved || !remaining.length || missingApproval}
            onClick={apply}
          >
            {api.demo ? "Apply demo changes" : "Apply selected changes"}
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="tabs tabs-box w-fit">
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
        {tab !== "Settings" && (
          <p className="text-sm font-semibold">
            <span className="text-libby">Libby</span> · <span className="text-fable">Fable</span>
          </p>
        )}
      </div>
      {busy ? (
        <p role="status" className="alert alert-info border-2 border-pop">
          Fetching library changes…
        </p>
      ) : error ? (
        <div role="alert" className="alert alert-error border-2 border-pop">
          <span>
            <strong>Fail</strong> — {error}
            {syncResult ? ". The previous comparison is shown below." : ""}
          </span>
        </div>
      ) : (
        resultSummary && (
          <p
            role={resultSummary.status === "Success" ? "status" : "alert"}
            className={`alert border-2 border-pop ${resultSummary.status === "Success" ? "alert-success" : "alert-error"}`}
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
        <div role="tabpanel" aria-label="Settings" className="contents">
          <SyncSettingsPanel
            value={settings ?? SYNC_FALLBACKS}
            busy={busy || !saved}
            onChange={(value) => saveSettings(value)}
            onReset={() => saveSettings({})}
          />
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
              books={summarizeBooks(syncResult.rows)}
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
        <div role="tabpanel" aria-label="Changes" className="contents">
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
          {syncResult.plan.conflicts.map((conflict) => (
            <div
              key={JSON.stringify([conflict.libbyBookIds, conflict.fableBookIds, conflict.message])}
              role="alert"
              className="alert alert-warning"
            >
              <span>Book matching needs review: {conflict.message}. No ambiguous book changes will be applied.</span>
            </div>
          ))}
          {(syncResult.plan.conflicts.length > 0 || Object.keys(syncResult.plan.options.matches ?? {}).length > 0) && (
            <Panel title="Review book matches">
              <p className="mb-3 text-sm opacity-70">
                Only confirm editions that represent the same work. Passage annotations still need compatible edition
                and location evidence.
              </p>
              <div className="space-y-3">
                {[
                  ...new Set([
                    ...syncResult.plan.conflicts.flatMap((conflict) => conflict.libbyBookIds),
                    ...Object.keys(syncResult.plan.options.matches ?? {}),
                  ]),
                ].map((bookId) => {
                  const book = syncResult.plan.snapshots.libby.find((candidate) => candidate.bookId === bookId);
                  if (!book) return null;
                  return (
                    <label key={bookId} className="flex flex-col gap-2 text-sm font-semibold">
                      <span>
                        Match {book.title} by {book.author ?? "Unknown author"}
                      </span>
                      <select
                        className="select w-full"
                        aria-label={`Match ${book.title}`}
                        value={syncResult.plan.options.matches?.[bookId] ?? ""}
                        disabled={busy || !saved}
                        onChange={(event) => {
                          const { [bookId]: _previous, ...others } = syncResult.plan.options.matches ?? {};
                          void sync({
                            ...syncResult.plan.options,
                            matches: event.target.value ? { ...others, [bookId]: event.target.value } : others,
                          });
                        }}
                      >
                        <option value="">Leave unmatched</option>
                        {syncResult.plan.snapshots.fable.map((candidate) => (
                          <option key={candidate.bookId} value={candidate.bookId}>
                            {candidate.title} by {candidate.author ?? "Unknown author"}
                          </option>
                        ))}
                      </select>
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
            {!syncResult.plan.operations.length ? (
              <p>No applicable changes in this preview.</p>
            ) : (
              <BookSections
                books={summarizeBooks(syncResult.rows).filter((book) =>
                  visibleOperations.some((operation) => operation.groupId === book.groupId),
                )}
                render={(book) => {
                  const bookOperations = visibleOperations.filter((operation) => operation.groupId === book.groupId);
                  const lineOperations = bookOperations.filter(
                    (operation) => LINE_FIELDS.has(operation.field) && !operation.removal,
                  );
                  const detailOperations = bookOperations.filter((operation) => !lineOperations.includes(operation));
                  const selectable = lineOperations.filter(
                    (operation) => !operation.blocked && outcomeOf(operation.id) !== "success",
                  );
                  const blocked = lineOperations.filter((operation) => operation.blocked);
                  const progress = lineOperations.find((operation) => operation.field === "readingProgress");
                  const before = progress?.before?.value;
                  return (
                    <BookLine
                      key={book.groupId}
                      book={book}
                      progressChange={
                        typeof progress?.after === "number"
                          ? progress.after - (typeof before === "number" ? before : 0)
                          : undefined
                      }
                      lead={
                        <>
                          {lineOperations.length > 0 ? (
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
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                          {blocked.length > 0 && (
                            <span title={blocked.map((operation) => operation.blocked).join("; ")}>
                              <Ban className="size-4 shrink-0 text-warning" role="img" aria-label="Blocked" />
                            </span>
                          )}
                          {lineOperations.length > 0 &&
                            lineOperations.every((operation) => outcomeOf(operation.id) === "success") && (
                              <CircleCheck className="size-4 shrink-0 text-success" role="img" aria-label="Applied" />
                            )}
                        </>
                      }
                      details={
                        detailOperations.length
                          ? detailOperations.map((operation) => (
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
                            ))
                          : undefined
                      }
                      open={detailOperations.some((operation) => operation.removal)}
                    />
                  );
                }}
              />
            )}
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
