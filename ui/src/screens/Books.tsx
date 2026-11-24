import { BookOpen, FileUp, Play, Sparkles } from "lucide-react";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { ActionSchema, MediaTypeSchema } from "../../../src/config.ts";
import type { InputFormat } from "../../../src/input.ts";
import { stripUndefined } from "../../../src/util.ts";
import { ConfirmRun, dash, Empty, Panel, Screen, sz } from "../components/ui.tsx";
import type { BookRequest } from "../lib/api.ts";
import { parseBookDraft } from "../lib/books.ts";
import { screen } from "../lib/spec.ts";
import { type BookDraftEdit, useStore } from "../lib/store.tsx";

const parts = screen("books")?.regions.flatMap((r) => r.components) ?? [];
const textareaLabel = parts.find((c) => c.type === "textarea")?.label ?? "One book per line";
const dropLabel = parts.find((c) => c.type === "dropzone")?.label ?? "Drop a file";
const formatSpec = parts.find((c) => c.type === "select");
const FORMATS = (formatSpec?.options ?? ["auto", "text", "csv", "tsv", "json"]) as ("auto" | InputFormat)[];
const MEDIA = MediaTypeSchema.options;
const ACTIONS = ActionSchema.options;

const SAMPLE = "Piranesi by Susanna Clarke\nProject Hail Mary by Andy Weir\nisbn:9780593135204\nDune - Frank Herbert";

export function Books() {
  const { config, configError, set, cards, api, go, setBooks, setResults, draft, setDraft, refreshCards } = useStore();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string>();
  const confirm = useRef<HTMLDialogElement>(null);

  const parsed = useMemo(
    () => parseBookDraft(draft.text, draft.format, draft.fileName),
    [draft.text, draft.format, draft.fileName],
  );
  const bookRows = parsed.books.map((b, index) => ({
    book: stripUndefined({ ...b, ...draft.edits[index] }) as BookRequest,
    index,
    key: `${b.raw}-${index}`,
  }));
  const books = bookRows.map(({ book }) => book);
  const edit = (index: number, patch: BookDraftEdit) =>
    setDraft({ edits: { ...draft.edits, [index]: { ...draft.edits[index], ...patch } } });

  async function readFile(f: File) {
    setDraft({ fileName: f.name, text: await f.text() });
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void readFile(f);
  }

  async function go_() {
    if (configError) return;
    setBusy(true);
    setRunError(undefined);
    setResults(undefined);
    try {
      const rows = await api.run(books, config);
      refreshCards();
      setBooks(books);
      setResults({ rows, dryRun: config.dryRun });
      go("results");
    } catch (err) {
      setRunError((err as Error).message);
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
      className="select select-sm w-full min-w-0"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{label}</option>
      {choices.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
  const rowControls = (b: BookRequest, index: number) => ({
    format: cellSelect(
      b.mediaTypes?.[0],
      MEDIA,
      (v) => edit(index, { mediaTypes: v ? [MediaTypeSchema.parse(v)] : undefined }),
      "format",
    ),
    action: cellSelect(
      b.action,
      ACTIONS,
      (v) => edit(index, { action: v ? ActionSchema.parse(v) : undefined }),
      "action",
    ),
    libs: cellSelect(
      b.libraries?.[0],
      cards.map((c) => c.advantageKey),
      (v) => edit(index, { libraries: v ? [v] : undefined }),
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
            <span>
              Preview only{" "}
              <span className="block text-sm font-normal opacity-70">No loans or holds will be placed</span>
            </span>
          </label>
          <button
            type="button"
            className="btn btn-primary btn-pop btn-lg"
            disabled={!books.length || busy || Boolean(configError)}
            onClick={() => (config.dryRun ? void go_() : confirm.current?.showModal())}
          >
            {busy ? (
              <span className="loading loading-spinner" />
            ) : config.dryRun ? (
              <Sparkles className="size-5" />
            ) : (
              <Play className="size-5" />
            )}
            {config.dryRun ? "Preview results" : "Borrow or place holds"}
          </button>
        </>
      }
    >
      {configError && (
        <div role="alert" className="alert alert-error border-2 border-pop">
          <p>{configError}</p>
        </div>
      )}
      {runError && (
        <div role="alert" className="alert alert-error border-2 border-pop">
          <p>Run failed: {runError}</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
        <Panel className="flex flex-col gap-3">
          <label htmlFor="books-text" className="text-sm font-semibold">
            {textareaLabel}
          </label>
          <textarea
            id="books-text"
            className={`textarea min-h-40 w-full font-mono text-sm leading-relaxed ${sz("textarea")} ${parsed.error ? "textarea-error" : ""}`}
            placeholder={SAMPLE}
            value={draft.text}
            onChange={(e) => {
              setDraft({ text: e.target.value, fileName: undefined });
            }}
          />
          <p className="text-sm opacity-70">Enter one title per line, or upload a list.</p>
          {parsed.error && (
            <p role="alert" className="text-sm text-error">
              {parsed.error}
            </p>
          )}
          {!draft.text && (
            <button
              type="button"
              className="btn btn-ghost btn-sm self-start"
              onClick={() => setDraft({ text: SAMPLE })}
            >
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
            <span className="text-sm font-semibold">{draft.fileName ?? dropLabel}</span>
            <span className="text-sm opacity-70">Choose a file or drag it here</span>
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
              value={draft.format}
              onChange={(e) => setDraft({ format: e.target.value as "auto" | InputFormat })}
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
                  {bookRows.map(({ book: b, index, key }) => {
                    const c = rowControls(b, index);
                    return (
                      <tr key={key}>
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
              {bookRows.map(({ book: b, index, key }) => {
                const c = rowControls(b, index);
                return (
                  <li key={key} className="rounded-field border-2 border-base-300 p-3">
                    <p className="font-semibold">{dash(b.title ?? b.isbn ?? b.titleId)}</p>
                    <p className="text-sm opacity-70">{dash(b.author)}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
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
