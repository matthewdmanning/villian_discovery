import { Download, ListChecks, Rocket } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmRun, dash, Empty, Panel, Screen, StatusBadge, sz } from "../components/ui.tsx";
import type { BookResult, ResultStatus } from "../lib/api.ts";
import { screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const parts = screen("results")?.regions.flatMap((r) => r.components) ?? [];
const STATS = (parts.find((c) => c.type === "stats")?.values ?? []) as ResultStatus[];
const CHIPS = parts.find((c) => c.type === "chips")?.values ?? ["all"];

/** A chip also shows its dry-run twin: "held" includes "would-hold". */
const twin: Record<string, ResultStatus> = { borrowed: "would-borrow", held: "would-hold" };

function download(rows: BookResult[], file: string | undefined) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: file?.split("/").pop() || "libby-report.json",
  });
  a.click();
  URL.revokeObjectURL(url);
}

export function Results() {
  const { results, setResults, books, api, config, go } = useStore();
  const [chip, setChip] = useState("all");
  const [busy, setBusy] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);

  if (!results)
    return (
      <Screen id="results">
        <Empty icon={<ListChecks className="size-7" />} title="No plan yet">
          <button type="button" className="btn btn-primary btn-pop" onClick={() => go("books")}>
            Add books
          </button>
        </Empty>
      </Screen>
    );

  const count = (s: ResultStatus) => results.rows.filter((r) => r.status === s).length;
  const rows = results.rows.filter((r) => chip === "all" || r.status === chip || r.status === twin[chip]);

  async function runForReal() {
    setBusy(true);
    try {
      setResults({ rows: await api.run(books, { ...config, dryRun: false }), dryRun: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      id="results"
      actions={
        <>
          <button
            type="button"
            className={`btn btn-pop ${sz("btn")}`}
            onClick={() => download(results.rows, config.output.reportFile)}
          >
            <Download className="size-4" /> Export report
          </button>
          {results.dryRun && (
            <button
              type="button"
              className="btn btn-primary btn-pop btn-lg"
              disabled={busy}
              onClick={() => confirm.current?.showModal()}
            >
              {busy ? <span className="loading loading-spinner" /> : <Rocket className="size-5" />}
              Run for real
            </button>
          )}
        </>
      }
    >
      <dl className="surface grid grid-cols-3 gap-px overflow-hidden bg-base-300 p-0 sm:grid-cols-6">
        {STATS.map((s) => (
          <div key={s} className="bg-base-100 px-4 py-3">
            <dt className="truncate text-xs opacity-70">{s}</dt>
            <dd
              className={`font-display text-2xl font-semibold tabular-nums sm:text-3xl ${count(s) && s === "error" ? "text-error" : ""}`}
            >
              {count(s)}
            </dd>
          </div>
        ))}
      </dl>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Filter by status</legend>
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={chip === c}
            className={`btn btn-sm rounded-full ${chip === c ? "btn-neutral" : "btn-ghost border-2 border-base-300"}`}
            onClick={() => setChip(c)}
          >
            {c}
          </button>
        ))}
      </fieldset>

      <Panel>
        {!rows.length ? (
          <p className="py-6 text-center opacity-70">Nothing here</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className={`table ${sz("table")}`}>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Title</th>
                    <th>Author</th>
                    <th>Type</th>
                    <th>Library</th>
                    <th>Card</th>
                    <th className="text-end">Days</th>
                    <th className="text-end">Wait</th>
                    <th className="text-end">Queue</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.input}-${r.library ?? i}`}>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="font-semibold">{dash(r.title ?? r.input)}</td>
                      <td>{dash(r.author)}</td>
                      <td>{dash(r.mediaType)}</td>
                      <td>
                        <code className="font-mono text-sm">{dash(r.library)}</code>
                      </td>
                      <td>{dash(r.cardName)}</td>
                      <td className="text-end tabular-nums">{dash(r.loanDays)}</td>
                      <td className="text-end tabular-nums">
                        {r.estimatedWaitDays !== undefined ? `${r.estimatedWaitDays}d` : "—"}
                      </td>
                      <td className="text-end tabular-nums">{dash(r.holdsCount)}</td>
                      <td className="text-sm opacity-80">{dash(r.message)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((r, i) => (
                <li key={`${r.input}-${r.library ?? i}`} className="rounded-field border-2 border-base-300 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{r.title ?? r.input}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-sm opacity-70">
                    {r.message ??
                      [
                        r.cardName,
                        r.mediaType,
                        r.loanDays && `${r.loanDays} days`,
                        r.estimatedWaitDays !== undefined && `${r.estimatedWaitDays}d wait`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <ConfirmRun dialog={confirm} onConfirm={runForReal} />
    </Screen>
  );
}
