import type { SyncSettings } from "../../../src/sync-config.ts";
import { SyncSettingsSchema } from "../../../src/sync-config.ts";
import { Panel, sz, Toggle } from "./ui.tsx";

const LABELS = {
  conflicts: "Undated conflicts",
  removals: "Removals",
  showNonConflicting: "Show non-conflicting changes",
  metadataScope: "Shared metadata",
} as const;
type SelectKey = keyof typeof LABELS;
const CHOICES: Record<string, string> = {
  "all-shared": "All compatible shared metadata",
  "lists-tags": "Lists and tags",
  "lists-tags-notes": "Lists, tags, and notes",
  ask: "Ask for each conflict",
  libby: "Prefer Libby",
  fable: "Prefer Fable",
  none: "No removals",
  "fields-memberships": "Field clears and memberships",
  "all-supported": "All supported removals",
  no: "No",
  yes: "Yes",
};

/** Use this component to edit one user's validated sync settings; choices come from SyncSettingsSchema, and the owning screen saves each change as it happens. */
export function SyncSettingsPanel({
  value,
  busy,
  onChange,
  onReset,
}: {
  value: SyncSettings;
  busy: boolean;
  onChange(value: SyncSettings): void;
  onReset(): void;
}) {
  const select = (key: SelectKey) => (
    <label key={key} className="flex flex-col gap-2 text-sm font-semibold">
      <span>{LABELS[key]}</span>
      <select
        aria-label={LABELS[key]}
        className={`select w-full ${sz("select")}`}
        value={value[key]}
        disabled={busy}
        onChange={(event) => onChange(SyncSettingsSchema.parse({ ...value, [key]: event.target.value }))}
      >
        {SyncSettingsSchema.shape[key].options.map((option) => (
          <option key={option} value={option}>
            {CHOICES[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Panel title="Your sync settings">
      <p className="mb-4 text-sm opacity-70">Changes save automatically. Removals always need your confirmation.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {select("conflicts")}
        {select("removals")}
        {select("showNonConflicting")}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold">Advanced</summary>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {select("metadataScope")}
          <Toggle
            label="Allow decrease in progress"
            checked={value.allowProgressDecrease}
            disabled={busy}
            onChange={(checked) => onChange(SyncSettingsSchema.parse({ ...value, allowProgressDecrease: checked }))}
          />
        </div>
      </details>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </Panel>
  );
}
