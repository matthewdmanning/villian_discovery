import { Ban, CircleCheck, CircleX, Trash2 } from "lucide-react";
import type { SyncProvider } from "../../../src/sync.ts";
import type { SyncOperation, SyncOutcome } from "../../../src/sync-plan.ts";
import { displaySyncValue, SYNC_FIELD_LABELS } from "../lib/sync-format.ts";

export const APP_NAMES: Record<SyncProvider, string> = { libby: "Libby", fable: "Fable" };

/** Use this function to tell whether a change overwrites a different value the destination app already holds. */
export function isAppConflict({ before }: SyncOperation): boolean {
  const value = before?.value;
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);
}

/** Use this component to show one app's value in that app's color; the app name is for screen readers and the edit time is on hover. */
export function AppValue({
  provider,
  value,
  field,
  updatedAt,
}: {
  provider: SyncProvider;
  value: unknown;
  field: string;
  updatedAt?: string | undefined;
}) {
  const name = APP_NAMES[provider];
  return (
    <span
      className={`font-semibold ${provider === "libby" ? "text-libby" : "text-fable"}`}
      title={updatedAt ? `${name} · edited ${new Date(updatedAt).toLocaleString()}` : name}
    >
      <span className="sr-only">{name}: </span>
      {displaySyncValue(value, field)}
    </span>
  );
}

/** Use this component to review one proposed write on one line and explicitly acknowledge any removal before applying. */
export function SyncChange({
  operation,
  selected,
  removalApproved,
  outcome,
  disabled,
  onSelect,
  onRemoval,
}: {
  operation: SyncOperation;
  selected: boolean;
  removalApproved: boolean;
  outcome?: SyncOutcome["status"] | undefined;
  disabled: boolean;
  onSelect(value: boolean): void;
  onRemoval(value: boolean): void;
}) {
  const { title, field, target, source, before, after, blocked, removal } = operation;
  const provider = APP_NAMES[target];
  const label = SYNC_FIELD_LABELS[field] ?? field;
  const completed = outcome === "success";
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
      {removal && <Trash2 className="size-4 shrink-0 text-error" role="img" aria-label="Removal" />}
      <span className="min-w-0 flex-1 break-words">
        <span className="capitalize">{label}</span>:{" "}
        <AppValue provider={target} value={before?.value} field={field} updatedAt={before?.updatedAt} /> →{" "}
        <AppValue provider={source} value={after} field={field} />
      </span>
      {blocked && (
        <span title={`Blocked: ${blocked}`}>
          <Ban className="size-4 shrink-0 text-warning" role="img" aria-label={`Blocked: ${blocked}`} />
        </span>
      )}
      {outcome === "success" && (
        <CircleCheck className="size-4 shrink-0 text-success" role="img" aria-label="Applied" />
      )}
      {outcome && outcome !== "success" && (
        <CircleX className="size-4 shrink-0 text-error" role="img" aria-label={`Result: ${outcome}`} />
      )}
      {selected && removal && !blocked && !completed && (
        <label className="flex items-center gap-1 text-error">
          <input
            type="checkbox"
            className="checkbox checkbox-error checkbox-sm"
            checked={removalApproved}
            disabled={disabled}
            aria-label={`Confirm removal of ${label} on ${provider} for ${title}`}
            onChange={(event) => onRemoval(event.target.checked)}
          />
          Approve removal
        </label>
      )}
      <input
        type="checkbox"
        className="checkbox checkbox-primary checkbox-sm"
        aria-label={`Apply ${label} to ${provider} for ${title}`}
        checked={selected}
        disabled={disabled || Boolean(blocked) || completed}
        onChange={(event) => onSelect(event.target.checked)}
      />
    </li>
  );
}
