import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { SyncField } from "../../../src/sync.ts";
import { SYNC_FALLBACKS, type SyncSettings } from "../../../src/sync-config.ts";
import { type SyncApprovals, type SyncPreviewOptions, syncDecisionKey } from "../../../src/sync-plan.ts";
import { SyncChange } from "../components/SyncChange.tsx";
import { SyncSettingsPanel } from "../components/SyncSettings.tsx";
import { Empty, Panel, Screen, sz } from "../components/ui.tsx";
import { screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";
import { displaySyncValue as displayValue, SYNC_FIELD_LABELS as labels } from "../lib/sync-format.ts";

const components = screen("sync")?.regions.flatMap((region) => region.components) ?? [];
const rules = components.filter((component) => component.type === "rule");
/** Use this component to show a source field and its actual edit timestamp, using displayValue for the normalized value. */
function SourceValue({ value, field }: { value: SyncField["libby"]; field: string }) {
  return (
    <div>
      <span>{displayValue(value?.value, field)}</span>
      {value?.updatedAt && (
        <time dateTime={value.updatedAt} className="mt-1 block text-xs opacity-60">
          {new Date(value.updatedAt).toLocaleString()}
        </time>
      )}
    </div>
  );
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
  const review: SyncApprovals = syncResult?.review ?? { selected: [], removals: [], publicCopies: [] };
  const [settings, setSettings] = useState<SyncSettings>();
  const [draft, setDraft] = useState<SyncSettings>({ ...SYNC_FALLBACKS });
  const saved = settings !== undefined && JSON.stringify(settings) === JSON.stringify(draft);

  useEffect(() => {
    let active = true;
    setSettings(undefined);
    api.getSyncSettings().then(
      (value) => {
        if (active) {
          setSettings(value);
          setDraft(value);
        }
      },
      (failure) => {
        if (active)
          setError(
            `Saved settings could not be loaded: ${String(failure)}. The editor shows fallback values until you save or reset.`,
          );
      },
    );
    return () => {
      active = false;
    };
  }, [api, setError]);

  /** Use this function to save validated user overrides before generating a new preview; an empty object restores the shipped fallback values. */
  async function saveSettings(input: unknown = draft) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const value = await api.saveSyncSettings(input);
      setSettings(value);
      setDraft(value);
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
            .filter((operation) => !operation.blocked && !operation.removal && !operation.publicExposure)
            .map((operation) => operation.id),
          removals: [],
          publicCopies: [],
        },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

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
  const missingApproval = remaining.some(
    (operation) =>
      operation.blocked ||
      (operation.removal && !review.removals.includes(operation.id)) ||
      (operation.publicExposure && !review.publicCopies.includes(operation.id)),
  );

  /** Use this function to resolve ordinary metadata conflicts by generating a new preview; Libby-authoritative fields cannot be overridden. */
  function conflictControls(row: SyncField) {
    if (!row.conflict || ["readingProgress", "checkedOut", "finished", "readingStatus"].includes(row.field))
      return null;
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {(["libby", "fable"] as const)
          .filter((provider) => row[provider])
          .map((provider) => (
            <button
              key={provider}
              type="button"
              className="btn btn-outline btn-xs"
              disabled={busy || !saved}
              aria-label={`Use ${provider === "libby" ? "Libby" : "Fable"} ${labels[row.field] ?? row.field} for ${row.title}`}
              onClick={() =>
                sync({
                  ...syncResult?.plan.options,
                  resolutions: { ...syncResult?.plan.options.resolutions, [syncDecisionKey(row)]: provider },
                })
              }
            >
              Use {provider === "libby" ? "Libby" : "Fable"}
            </button>
          ))}
      </div>
    );
  }

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
      <div role="note" className="alert alert-info border-2 border-pop">
        {api.demo
          ? "Demo accounts: Apply only updates simulated data. Your real Libby and Fable accounts are not read or changed."
          : "Preview changes before applying them. Unverified provider capabilities remain blocked."}
      </div>
      <Panel title="Sync rules">
        <ul className="space-y-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.label}>{rule.label}</li>
          ))}
        </ul>
      </Panel>
      <details open={settings === undefined}>
        <summary className="cursor-pointer font-display font-semibold">Sync settings</summary>
        <div className="mt-4">
          <SyncSettingsPanel
            value={draft}
            saved={saved}
            busy={busy}
            onChange={setDraft}
            onSave={() => saveSettings()}
            onReset={() => saveSettings({})}
          />
        </div>
      </details>
      {!saved && settings && (
        <p className="text-sm text-warning">Save settings before previewing or applying changes.</p>
      )}
      {error && (
        <div role="alert" className="alert alert-error border-2 border-pop">
          <span>
            Sync failed: {error}
            {syncResult ? ". The previous comparison is shown below." : ""}
          </span>
        </div>
      )}
      {syncResult ? (
        <>
          <p role="status" className="text-sm opacity-70">
            {new Set(syncResult.rows.map((row) => row.bookId)).size} books · {syncResult.rows.length} fields ·{" "}
            {syncResult.rows.filter((row) => row.conflict).length} need review
            <span className="mt-1 block">
              Last compared:{" "}
              <time dateTime={syncResult.comparedAt}>{new Date(syncResult.comparedAt).toLocaleString()}</time>
            </span>
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
          <Panel title="Proposed changes">
            <p className="mb-3 text-sm opacity-70">
              {syncResult.plan.operations.length} changes ·{" "}
              {syncResult.plan.operations.filter((operation) => operation.blocked).length} blocked. Select changes and
              review any risk confirmations before Apply.
            </p>
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
              <ul className="space-y-3">
                {[...syncResult.plan.operations]
                  .sort((left, right) => Number(right.removal) - Number(left.removal))
                  .map((operation) => (
                    <SyncChange
                      key={operation.id}
                      operation={operation}
                      disabled={busy || !saved}
                      selected={review.selected.includes(operation.id)}
                      removalApproved={review.removals.includes(operation.id)}
                      exposureApproved={review.publicCopies.includes(operation.id)}
                      outcome={
                        syncResult.report?.outcomes.find((outcome) => outcome.operationId === operation.id)?.status
                      }
                      onSelect={(value) => toggleReview("selected", operation.id, value)}
                      onRemoval={(value) => toggleReview("removals", operation.id, value)}
                      onExposure={(value) => toggleReview("publicCopies", operation.id, value)}
                    />
                  ))}
              </ul>
            )}
            {syncResult.report && (
              <section className="mt-4 rounded-field border-2 border-base-300 p-3 text-sm" aria-label="Apply results">
                <strong>Apply results</strong>
                <ul>
                  {syncResult.report.outcomes.map((outcome) => (
                    <li key={outcome.operationId}>
                      {outcome.status}: {outcome.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">Preview again to compare the current provider state.</p>
              </section>
            )}
          </Panel>
          <Panel title={components.find((component) => component.type === "table")?.label}>
            <div className="hidden overflow-x-auto md:block">
              <table className={`table ${sz("table")}`}>
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Field</th>
                    <th>Libby</th>
                    <th>Fable</th>
                    <th>Combined value</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {syncResult.rows.map((row) => (
                    <tr key={JSON.stringify([row.bookId, row.field])}>
                      <td className="font-semibold">{row.title}</td>
                      <td className="capitalize">{labels[row.field] ?? row.field}</td>
                      <td>
                        <SourceValue value={row.libby} field={row.field} />
                      </td>
                      <td>
                        <SourceValue value={row.fable} field={row.field} />
                      </td>
                      <td>
                        {row.conflict ? (
                          <div>
                            <span className="text-warning">Needs review: {row.conflict}</span>
                            {conflictControls(row)}
                          </div>
                        ) : (
                          displayValue(row.value, row.field)
                        )}
                      </td>
                      <td>
                        {row.conflict ? (
                          <span className="badge badge-warning">Conflict</span>
                        ) : (
                          <span className={`badge ${row.source === "libby" ? "badge-primary" : "badge-secondary"}`}>
                            {row.source === "libby" ? "Libby" : "Fable"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {syncResult.rows.map((row) => (
                <li
                  key={JSON.stringify([row.bookId, row.field])}
                  className="rounded-field border-2 border-base-300 p-3"
                >
                  <p className="font-semibold">{row.title}</p>
                  <p className="mt-1 text-sm capitalize">{labels[row.field] ?? row.field}</p>
                  <dl className="my-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="opacity-60">Libby</dt>
                      <dd>
                        <SourceValue value={row.libby} field={row.field} />
                      </dd>
                    </div>
                    <div>
                      <dt className="opacity-60">Fable</dt>
                      <dd>
                        <SourceValue value={row.fable} field={row.field} />
                      </dd>
                    </div>
                  </dl>
                  {row.conflict ? (
                    <div>
                      <p className="text-sm text-warning">Needs review: {row.conflict}</p>
                      {conflictControls(row)}
                    </div>
                  ) : (
                    <p className="text-sm font-semibold">
                      {displayValue(row.value, row.field)} · {row.source === "libby" ? "Libby" : "Fable"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </>
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
