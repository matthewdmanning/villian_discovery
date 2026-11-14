import { RotateCcw } from "lucide-react";
import { MediaTypeSchema } from "../../../src/config.ts";
import { isValidSuspendDays } from "../../../src/libby-client.ts";
import { Advanced, Field, NumberField, OrderedList, Panel, Screen, Segmented, sz, Toggle } from "../components/ui.tsx";
import { choicesOf, DEFAULTS, getPath, rangeOf } from "../lib/config.ts";
import { labelFor, type SpecComponent, screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const SUSPEND = Array.from({ length: 91 }, (_, d) => d).filter(isValidSuspendDays);
const LENDING = [...choicesOf("borrow.lendingPeriod"), "7", "14", "21"];

/** Renders one wireframe component against the config path it binds. */
function Bound({ c }: { c: SpecComponent }) {
  const { config, set } = useStore();
  const path = c.binds as string;
  const value = getPath(config, path);
  const onNum = (v: number | undefined) => set(path, v);
  const range = rangeOf(path);

  switch (c.type) {
    case "toggle":
      return <Toggle label={c.label} checked={Boolean(value)} onChange={(v) => set(path, v)} />;
    case "segmented":
      return (
        <Segmented label={c.label} value={String(value)} choices={choicesOf(path)} onChange={(v) => set(path, v)} />
      );
    case "number":
      return (
        <NumberField
          label={c.label}
          value={value as number | undefined}
          onChange={onNum}
          min={range.min ?? 0}
          max={range.max}
          {...(path.endsWith("Ms") && { suffix: "ms", step: 50 })}
          {...(path.endsWith("Days") && { suffix: "days" })}
        />
      );
    case "slider": {
      const n = Number(value);
      return (
        <Field label={c.label}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              className="range range-primary range-sm grow"
              min={range.min ?? 0}
              max={range.max ?? 1}
              step={0.01}
              value={n}
              onChange={(e) => set(path, Number(e.target.value))}
            />
            <output className="w-12 text-end font-mono tabular-nums">{n.toFixed(2)}</output>
          </div>
        </Field>
      );
    }
    case "select": {
      const choices = path === "hold.suspendDays" ? SUSPEND.map(String) : LENDING;
      return (
        <Field label={c.label}>
          <select
            className={`select w-full ${sz("select")}`}
            value={String(value)}
            onChange={(e) => {
              const v = e.target.value;
              set(path, /^\d+$/.test(v) ? Number(v) : v);
            }}
          >
            {choices.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      );
    }
    case "field":
      return (
        <Field label={c.label}>
          <input
            type={c.binds?.includes("email") ? "email" : "text"}
            autoComplete="email"
            className={`input w-full ${sz("input")}`}
            placeholder="—"
            value={(value as string | undefined) ?? ""}
            onChange={(e) => set(path, e.target.value || undefined)}
          />
        </Field>
      );
    default:
      return null;
  }
}

function MediaOrder() {
  const { config, set } = useStore();
  const have = new Set<string>(config.mediaTypes);
  return (
    <OrderedList
      label={labelFor("settings", "mediaTypes", "Media types")}
      items={config.mediaTypes}
      onChange={(v) => set("mediaTypes", v)}
      extra={MediaTypeSchema.options.filter((m) => !have.has(m))}
      onAdd={(m) => set("mediaTypes", [...config.mediaTypes, m])}
      onRemove={(m) =>
        set(
          "mediaTypes",
          config.mediaTypes.filter((x) => x !== m),
        )
      }
    />
  );
}

const TITLES: Record<string, string> = {
  general: "General",
  borrow: "Borrow",
  hold: "Hold",
  matching: "Matching",
  network: "Network",
};

export function Settings() {
  const { overrides, configError, set } = useStore();
  const regions = screen("settings")?.regions ?? [];
  const changed = Object.keys(overrides).some(
    (k) => k !== "auth" && k !== "cards" && k !== "libraries" && k !== "dryRun",
  );

  const body = (id: string) =>
    regions
      .find((r) => r.id === id)
      ?.components.map((c) =>
        c.binds === "mediaTypes" ? <MediaOrder key={c.label} /> : <Bound key={c.label} c={c} />,
      );

  return (
    <Screen
      id="settings"
      actions={
        changed && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              for (const k of Object.keys(DEFAULTS))
                if (!["auth", "cards", "libraries", "dryRun"].includes(k)) set(k, undefined);
            }}
          >
            <RotateCcw className="size-4" /> Reset
          </button>
        )
      }
    >
      {configError && (
        <div role="alert" className="alert alert-error border-2 border-pop">
          <pre className="whitespace-pre-wrap font-mono text-xs">{configError}</pre>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {regions
          .filter((r) => !r.advanced)
          .map((r) => (
            <Panel key={r.id} title={TITLES[r.id] ?? r.id} className={r.id === "general" ? "lg:col-span-2" : ""}>
              <div className={r.id === "general" ? "grid gap-x-8 gap-y-2 md:grid-cols-2" : "space-y-1"}>
                {body(r.id)}
              </div>
            </Panel>
          ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {regions
          .filter((r) => r.advanced)
          .map((r) => (
            <Advanced key={r.id} title={TITLES[r.id] ?? r.id}>
              <div className="space-y-1">{body(r.id)}</div>
            </Advanced>
          ))}
      </div>
    </Screen>
  );
}
