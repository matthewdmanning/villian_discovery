import { ChevronDown, ChevronUp, GripVertical, Rocket } from "lucide-react";
import { type ReactNode, type RefObject, useId, useState } from "react";
import type { ResultStatus } from "../lib/api.ts";
import { options, type ScreenId, screen } from "../lib/spec.ts";

export const compact = options.density === "compact";
/** daisyUI size modifier for form controls and buttons, from `options.density`. */
export const sz = (kind: "btn" | "input" | "select" | "toggle" | "checkbox" | "textarea" | "table" | "badge") =>
  compact ? `${kind}-sm` : "";

export function Screen({ id, actions, children }: { id: ScreenId; actions?: ReactNode; children: ReactNode }) {
  const s = screen(id);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`mx-auto w-full max-w-5xl ${compact ? "space-y-4" : "space-y-6"}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={`${id}-title`} className="text-2xl font-semibold sm:text-3xl">
          {s?.title}
        </h1>
        {s && <kbd className="kbd kbd-sm font-mono opacity-70">libby-shelf {s.cli}</kbd>}
      </header>
      {children}
      {actions && <div className="flex flex-wrap items-center justify-end gap-3">{actions}</div>}
    </section>
  );
}

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`surface ${compact ? "p-4" : "p-5 sm:p-6"} ${className}`}>
      {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {children}
    </div>
  );
}

/** Collapsible group for regions marked `advanced`; open when `options.showAdvanced`. */
export function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="collapse collapse-arrow surface" open={options.showAdvanced}>
      <summary className="collapse-title font-display text-lg font-semibold">{title}</summary>
      <div className="collapse-content">{children}</div>
    </details>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span>{props.label}</span>
      <input
        type="checkbox"
        className={`toggle toggle-primary ${sz("toggle")}`}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend text-sm">{label}</legend>
      {children}
      {hint && <p className="label text-xs">{hint}</p>}
    </fieldset>
  );
}

export function NumberField(props: {
  label: string;
  value: number | undefined;
  onChange(v: number | undefined): void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number;
  suffix?: string;
}) {
  return (
    <Field label={props.label}>
      <label className={`input w-full ${sz("input")}`}>
        <input
          type="number"
          inputMode="numeric"
          className="grow tabular-nums"
          placeholder="—"
          value={props.value ?? ""}
          min={props.min}
          max={props.max}
          step={props.step}
          onChange={(e) => props.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        {props.suffix && <span className="label">{props.suffix}</span>}
      </label>
    </Field>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  choices: readonly T[];
  onChange(v: T): void;
}) {
  const name = useId();
  return (
    <Field label={props.label}>
      <div className="join w-full sm:w-auto" role="radiogroup">
        {props.choices.map((c) => (
          <input
            key={c}
            type="radio"
            name={name}
            aria-label={c}
            className={`btn join-item btn-pop grow capitalize sm:grow-0 ${sz("btn")} ${props.value === c ? "btn-primary" : "bg-base-100"}`}
            checked={props.value === c}
            onChange={() => props.onChange(c)}
          />
        ))}
      </div>
    </Field>
  );
}

/** Reorderable list: drag, or use the arrow buttons (keyboard and touch friendly). */
export function OrderedList(props: {
  label: string;
  items: string[];
  onChange(items: string[]): void;
  extra?: string[];
  onAdd?(item: string): void;
  onRemove?(item: string): void;
  render?(item: string): ReactNode;
}) {
  const [dragging, setDragging] = useState<number>();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= props.items.length || from === to) return;
    const next = [...props.items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it as string);
    props.onChange(next);
  };
  return (
    <Field label={props.label}>
      <ol className="flex flex-wrap gap-2">
        {props.items.map((it, i) => (
          <li
            key={it}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragging !== undefined && move(dragging, i)}
            onDragEnd={() => setDragging(undefined)}
            className={`badge badge-lg h-auto gap-1 border-2 border-pop bg-secondary py-1 ps-1 pe-1 text-secondary-content shadow-pop-sm ${dragging === i ? "opacity-50" : ""}`}
          >
            <GripVertical aria-hidden className="size-4 cursor-grab opacity-60" />
            <span className="font-semibold tabular-nums">{i + 1}.</span>
            <span>{props.render ? props.render(it) : it}</span>
            <span className="flex">
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label={`Move ${it} up`}
                onClick={() => move(i, i - 1)}
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square"
                aria-label={`Move ${it} down`}
                onClick={() => move(i, i + 1)}
              >
                <ChevronDown className="size-4" />
              </button>
              {props.onRemove && props.items.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs btn-square"
                  aria-label={`Remove ${it}`}
                  onClick={() => props.onRemove?.(it)}
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
        {props.extra?.map((it) => (
          <li key={it}>
            <button
              type="button"
              className="btn btn-outline btn-sm rounded-full border-dashed"
              onClick={() => props.onAdd?.(it)}
            >
              + {it}
            </button>
          </li>
        ))}
      </ol>
    </Field>
  );
}

const STATUS_TONE: Record<ResultStatus, string> = {
  borrowed: "badge-success",
  held: "badge-info",
  "would-borrow": "badge-dash border-success bg-success/15 text-base-content",
  "would-hold": "badge-dash border-info bg-info/15 text-base-content",
  skipped: "badge-warning",
  error: "badge-error",
};

export function StatusBadge({ status }: { status: ResultStatus }) {
  return (
    <span className={`badge whitespace-nowrap font-semibold ${STATUS_TONE[status]} ${sz("badge")}`}>{status}</span>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-box border-2 border-dashed border-base-300 px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-secondary text-secondary-content">{icon}</div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children}
    </div>
  );
}

/** Shows `—` for missing values so empty cells keep the grid readable. */
export const dash = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

/** Confirms a real run: borrows and holds change the user's Libby account. */
export function ConfirmRun({ dialog, onConfirm }: { dialog: RefObject<HTMLDialogElement | null>; onConfirm(): void }) {
  return (
    <dialog ref={dialog} className="modal modal-bottom sm:modal-middle">
      <div className="modal-box border-2 border-pop pb-safe shadow-pop">
        <h3 className="text-xl font-semibold">Run for real?</h3>
        <p className="py-3 opacity-80">Borrows and holds go to Libby.</p>
        <div className="modal-action">
          <form method="dialog">
            <button type="submit" className="btn btn-ghost">
              Cancel
            </button>
          </form>
          <button
            type="button"
            className="btn btn-primary btn-pop"
            onClick={() => {
              dialog.current?.close();
              onConfirm();
            }}
          >
            <Rocket className="size-4" /> Run
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  );
}
