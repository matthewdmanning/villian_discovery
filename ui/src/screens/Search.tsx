import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { parseBookLine } from "../../../src/input.ts";
import { dash, Empty, Panel, Screen, sz } from "../components/ui.tsx";
import type { Match } from "../lib/api.ts";
import { screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const queryLabel = screen("search")
  ?.regions.flatMap((r) => r.components)
  .find((c) => c.type === "field")?.label;

const score = (m: Match) => `${m.titleScore.toFixed(2)} / ${m.authorScore?.toFixed(2) ?? "—"}`;
const copies = (m: Match) => `${dash(m.media.availableCopies)} / ${dash(m.media.ownedCopies)}`;
const waitD = (m: Match) => (m.media.estimatedWaitDays ? `${m.media.estimatedWaitDays}d` : "—");

function Avail({ m }: { m: Match }) {
  return m.media.isAvailable ? (
    <span className="badge badge-success badge-sm font-semibold">now</span>
  ) : (
    <span className="badge badge-ghost badge-sm">wait</span>
  );
}

export function SearchScreen() {
  const { api, config } = useStore();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [matches, setMatches] = useState<Match[]>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      setMatches(await api.search(parseBookLine(q), config));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen id="search">
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <label className={`input input-lg w-full grow border-2 border-pop shadow-pop-sm ${error ? "input-error" : ""}`}>
          <Search aria-hidden className="size-5 opacity-60" />
          <input
            type="search"
            aria-label={queryLabel ?? "Search"}
            placeholder="Project Hail Mary by Andy Weir"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-pop btn-lg" disabled={!q.trim() || busy}>
          {busy && <span className="loading loading-spinner" />}
          Search
        </button>
      </form>
      {error && <p className="text-sm text-error">{error}</p>}

      {matches &&
        (matches.length ? (
          <Panel>
            <div className="hidden overflow-x-auto md:block">
              <table className={`table ${sz("table")}`}>
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Title</th>
                    <th>Creator</th>
                    <th>Type</th>
                    <th className="text-end">Score t/a</th>
                    <th>Avail</th>
                    <th className="text-end">Copies</th>
                    <th className="text-end">Holds</th>
                    <th className="text-end">Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={`${m.card.cardId}-${m.media.id}`}>
                      <td className="font-semibold">{m.card.cardName ?? m.card.advantageKey}</td>
                      <td>{m.media.title}</td>
                      <td>{dash(m.media.firstCreatorName)}</td>
                      <td>{dash(m.media.type?.id)}</td>
                      <td className="text-end font-mono tabular-nums">{score(m)}</td>
                      <td>
                        <Avail m={m} />
                      </td>
                      <td className="text-end tabular-nums">{copies(m)}</td>
                      <td className="text-end tabular-nums">{dash(m.media.holdsCount)}</td>
                      <td className="text-end tabular-nums">{waitD(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {matches.map((m) => (
                <li key={`${m.card.cardId}-${m.media.id}`} className="rounded-field border-2 border-base-300 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{m.media.title}</p>
                    <Avail m={m} />
                  </div>
                  <p className="text-sm opacity-70">
                    {m.card.cardName} · {m.media.type?.id} · {copies(m)} copies · {waitD(m)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <Empty icon={<Search className="size-7" />} title="No match" />
        ))}
    </Screen>
  );
}
