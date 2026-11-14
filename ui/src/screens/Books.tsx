import { BookOpen, FileUp, Play, Sparkles } from "lucide-react";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { ActionSchema, MediaTypeSchema } from "../../../src/config.ts";
import { detectFormat, type InputFormat, parseBooks } from "../../../src/input.ts";
import { stripUndefined } from "../../../src/util.ts";
import { ConfirmRun, dash, Empty, Panel, Screen, sz } from "../components/ui.tsx";
import type { BookRequest } from "../lib/api.ts";
import { labelFor, screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const parts = screen("books")?.regions.flatMap((r) => r.components) ?? [];
const textareaLabel = parts.find((c) => c.type === "textarea")?.label ?? "One book per line";
const dropLabel = parts.find((c) => c.type === "dropzone")?.label ?? "Drop a file";
const formatSpec = parts.find((c) => c.type === "select");
const FORMATS = (formatSpec?.options ?? ["auto", "text", "csv", "tsv", "json"]) as ("auto" | InputFormat)[];
const MEDIA = MediaTypeSchema.options;
const ACTIONS = ActionSchema.options;

const SAMPLE = "Piranesi by Susanna Clarke\nProject Hail Mary by Andy Weir\nisbn:9780593135204\nDune - Frank Herbert";

/** Per-row overrides keyed by the input line; `undefined` = use the Rules default. */
type Edit = { [K in "mediaTypes" | "action" | "libraries"]?: BookRequest[K] | undefined };
type Edits = Record<string, Edit>;

function parse(
  text: string,
  format: "auto" | InputFormat,
  fileName?: string,
): { books: BookRequest[]; error?: string } {
  if (!text.trim()) return { books: [] };
  const fmt =
    format === "auto"
      ? fileName
        ? detectFormat(fileName)
        : text.trimStart().startsWith("[")
          ? "json"
          : "text"
      : format;
  try {
    return { books: parseBooks(text, fmt) };
  } catch (e) {
    return { books: [], error: (e as Error).message };
  }
}

export function Books() {
  const { config, set, cards, api, go, setBooks, setResults } = useStore();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [format, setFormat] = useState<"auto" | InputFormat>("auto");
  const [edits, setEdits] = useState<Edits>({});
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);

  const parsed = useMemo(() => parse(text, format, fileName), [text, format, fileName]);
  const books = parsed.books.map((b) => stripUndefined({ ...b, ...edits[b.raw] }) as BookRequest);
  const edit = (raw: string, patch: Edit) => setEdits((e) => ({ ...e, [raw]: { ...e[raw], ...patch } }));

  async function readFile(f: File) {
    setFileName(f.name);
    setText(await f.text());
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void readFile(f);
  }

  async function go_() {
    setBusy(true);
    try {
      setBooks(books);
      setResults({ rows: await api.run(books, config), dryRun: config.dryRun });
      go("results");
    } finally {
      setBusy(false);
    }
  }

  const cellSelect = (
    value: string | undefined,
    choices: readonly string[],
    onChange: (v: string | undefined) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      className="select select-sm select-ghost w-full min-w-28"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{label}</option>
      {choices.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
  const rowControls = (b: BookRequest) => ({
    format: cellSelect(
      b.mediaTypes?.[0],
      MEDIA,
      (v) => edit(b.raw, { mediaTypes: v ? [MediaTypeSchema.parse(v)] : undefined }),
      "format",
    ),
    action: cellSelect(
      b.action,
      ACTIONS,
      (v) => edit(b.raw, { action: v ? ActionSchema.parse(v) : undefined }),
      "action",
    ),
    libs: cellSelect(
      b.libraries?.[0],
      cards.map((c) => c.advantageKey),
      (v) => edit(b.raw, { libraries: v ? [v] : undefined }),
      "library",
    ),
  });

  return (
    <Screen
      id="books"
      actions={
        <>
          <label className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={config.dryRun}
              onChange={(e) => set("dryRun", e.target.checked)}
            />
            {labelFor("books", "dryRun", "Dry run")}
          </label>
          <button
            type="button"
            className="btn btn-primary btn-pop btn-lg"
            disabled={!books.length || busy}
            onClick={() => (config.dryRun ? go_() : confirm.current?.showModal())}
          >
            {busy ? (
              <span className="loading loading-spinner" />
            ) : config.dryRun ? (
              <Sparkles className="size-5" />
            ) : (
              <Play className="size-5" />
            )}
            {config.dryRun ? "Plan" : "Run"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
        <Panel className="flex flex-col gap-2">
          <label htmlFor="books-text" className="text-sm font-semibold">
            {textareaLabel}
          </label>
          <textarea
            id="books-text"
            className={`textarea min-h-40 w-full font-mono text-sm leading-relaxed ${sz("textarea")} ${parsed.error ? "textarea-error" : ""}`}
            placeholder={SAMPLE}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(undefined);
            }}
          />
          {parsed.error && <p className="text-sm text-error">{parsed.error}</p>}
          {!text && (
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setText(SAMPLE)}>
              Try a sample
            </button>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-box border-2 border-dashed p-6 text-center transition-colors ${over ? "border-primary bg-primary/15" : "border-pop/40 bg-base-100 hover:bg-base-300/40"}`}
          >
            <FileUp className="size-8" />
            <span className="text-sm font-semibold">{fileName ?? dropLabel}</span>
            <input
              type="file"
              className="sr-only"
              accept=".txt,.csv,.tsv,.json"
              onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{formatSpec?.label ?? "Format"}</span>
            <select
              className={`select w-32 ${sz("select")}`}
              value={format}
              onChange={(e) => setFormat(e.target.value as InputFormat)}
            >
              {FORMATS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ConfirmRun dialog={confirm} onConfirm={go_} />
      <Panel
        title={
          <span className="flex items-center gap-2">
            Books <span className="badge badge-secondary">{books.length}</span>
          </span>
        }
      >
        {!books.length ? (
          <Empty icon={<BookOpen className="size-7" />} title="No books yet" />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className={`table ${sz("table")}`}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Author</th>
                    <th>ISBN</th>
                    <th>Format</th>
                    <th>Action</th>
                    <th>Libraries</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => {
                    const c = rowControls(b);
                    return (
                      <tr key={b.raw}>
                        <td className="font-semibold">{dash(b.title ?? (b.titleId && `id:${b.titleId}`))}</td>
                        <td>{dash(b.author)}</td>
                        <td className="font-mono text-xs">{dash(b.isbn)}</td>
                        <td>{c.format}</td>
                        <td>{c.action}</td>
                        <td>{c.libs}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {books.map((b) => {
                const c = rowControls(b);
                return (
                  <li key={b.raw} className="rounded-field border-2 border-base-300 p-3">
                    <p className="font-semibold">{dash(b.title ?? b.isbn ?? b.titleId)}</p>
                    <p className="text-sm opacity-70">{dash(b.author)}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {c.format}
                      {c.action}
                      {c.libs}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </Screen>
  );
}
