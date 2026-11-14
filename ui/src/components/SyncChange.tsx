import { Eye, Trash2 } from "lucide-react";
import type { SyncOperation, SyncOutcome } from "../../../src/sync-plan.ts";
import { displaySyncValue, SYNC_FIELD_LABELS } from "../lib/sync-format.ts";

/** Use this component to review one proposed write and explicitly acknowledge any removal or private-to-public copying before applying. */
export function SyncChange({
  operation,
  selected,
  removalApproved,
  exposureApproved,
  outcome,
  disabled,
  onSelect,
  onRemoval,
  onExposure,
}: {
  operation: SyncOperation;
  selected: boolean;
  removalApproved: boolean;
  exposureApproved: boolean;
  outcome?: SyncOutcome["status"] | undefined;
  disabled: boolean;
  onSelect(value: boolean): void;
  onRemoval(value: boolean): void;
  onExposure(value: boolean): void;
}) {
  const { title, field, target, before, after, blocked, removal, publicExposure: exposure } = operation;
  const provider = target === "libby" ? "Libby" : "Fable";
  const label = SYNC_FIELD_LABELS[field] ?? field;
  const completed = outcome === "success";
  return (
    <li
      className={`rounded-box border-2 p-4 ${removal ? "border-error bg-error/5" : exposure ? "border-warning bg-warning/5" : "border-base-300"}`}
    >
      <label className="flex items-start justify-between gap-4 font-semibold">
        <span>
          {title}{" "}
          <span className="block text-sm capitalize opacity-70">
            {label} → {provider}
          </span>
        </span>
        <input
          type="checkbox"
          className="checkbox checkbox-primary"
          aria-label={`Apply ${label} to ${provider} for ${title}`}
          checked={selected}
          disabled={disabled || Boolean(blocked) || completed}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </label>
      <dl className="my-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="opacity-60">Before</dt>
          <dd className="break-words">{displaySyncValue(before?.value, field)}</dd>
        </div>
        <div>
          <dt className="opacity-60">After</dt>
          <dd className="break-words font-semibold">{displaySyncValue(after, field)}</dd>
        </div>
      </dl>
      {removal && (
        <div className="my-3 flex gap-2 text-sm font-semibold text-error">
          <Trash2 className="size-5 shrink-0" />
          <span>REMOVAL: clears a field or removes data from {provider}. Review the before and after values.</span>
        </div>
      )}
      {exposure && (
        <div className="my-3 flex gap-2 text-sm font-semibold text-warning">
          <Eye className="size-5 shrink-0" />
          <span>PUBLIC EXPOSURE: copies private data to a public destination.</span>
        </div>
      )}
      {blocked && <p className="text-sm font-semibold text-warning">Blocked: {blocked}</p>}
      {selected && !blocked && !completed && (
        <div className="space-y-3 text-sm">
          {removal && (
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-error checkbox-sm"
                checked={removalApproved}
                disabled={disabled}
                aria-label={`Confirm removal of ${label} on ${provider} for ${title}`}
                onChange={(event) => onRemoval(event.target.checked)}
              />
              I reviewed and approve this removal.
            </label>
          )}
          {exposure && (
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-warning checkbox-sm"
                checked={exposureApproved}
                disabled={disabled}
                aria-label={`Confirm public copying of ${label} to ${provider} for ${title}`}
                onChange={(event) => onExposure(event.target.checked)}
              />
              I approve making this private data public.
            </label>
          )}
        </div>
      )}
      {outcome && <p className="mt-3 text-sm font-semibold">Result: {outcome}</p>}
    </li>
  );
}
