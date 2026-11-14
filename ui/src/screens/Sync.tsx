import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { SyncField } from "../../../src/sync.ts";
import { Empty, Panel, Screen, sz } from "../components/ui.tsx";
import { screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const components = screen("sync")?.regions.flatMap((region) => region.components) ?? [];
const rules = components.filter((component) => component.type === "rule");
const labels: Record<string, string> = {
  readingProgress: "Reading progress",
  checkedOut: "Checked out",
  finished: "Finished",
};

/** Use this function to display a normalized sync field's value; progress is a percentage and null represents an explicit clearing. */
function displayValue(value: unknown, field: string): string {
  if (value === undefined) return "Unknown";
  if (value === null) return "Cleared";
  if (field === "readingProgress") return `${value}%`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return Array.isArray(value) ? value.join(", ") || "Empty" : String(value);
}

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
  const { api, syncResult, setSyncResult } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** Use this function to update the local comparison only after the API completes successfully; errors preserve the previous result. */
  async function sync() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const rows = await api.sync();
      setSyncResult({ rows, comparedAt: new Date().toISOString() });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      id="sync"
      actions={
        <button type="button" className="btn btn-primary btn-pop btn-lg" disabled={busy} onClick={sync}>
          {busy ? <span className="loading loading-spinner" /> : <RefreshCw className="size-5" />}
          {api.demo ? components.find((component) => component.type === "button")?.label : "Sync libraries"}
        </button>
      }
    >
      <div role="note" className="alert alert-info border-2 border-pop">
        {api.demo
          ? "Demo preview: your Libby and Fable accounts are not read or changed."
          : "This comparison combines data inside this app. Your source accounts are not changed."}
      </div>
      <Panel title="Sync rules">
        <ul className="space-y-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.label}>{rule.label}</li>
          ))}
        </ul>
      </Panel>
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
                          <span className="text-warning">Needs review: {row.conflict}</span>
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
                    <p className="text-sm text-warning">Needs review: {row.conflict}</p>
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
