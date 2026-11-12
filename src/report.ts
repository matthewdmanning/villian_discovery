import type { BookResult, ResultStatus } from "./runner.js";

export function formatTable(results: BookResult[]): string {
  const cols: [string, (r: BookResult) => string][] = [
    ["STATUS", (r) => r.status],
    ["TITLE", (r) => truncate(r.title ?? r.input, 40)],
    ["AUTHOR", (r) => truncate(r.author ?? "", 22)],
    ["TYPE", (r) => r.mediaType ?? ""],
    ["LIBRARY", (r) => r.library ?? ""],
    ["DAYS", (r) => (r.loanDays ? `loan ${r.loanDays}` : r.estimatedWaitDays !== undefined ? `wait ~${r.estimatedWaitDays}` : "")],
    ["NOTE", (r) => r.message ?? ""],
  ];
  const rows = results.map((r) => cols.map(([, f]) => f(r)));
  const widths = cols.map(([h], i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(cols.map(([h]) => h)), ...rows.map(line)].join("\n");
}

export function summarize(results: BookResult[]): string {
  const counts = new Map<ResultStatus, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts].map(([s, n]) => `${n} ${s}`).join(", ") || "nothing to do";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
