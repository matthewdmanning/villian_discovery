import { TriangleAlert } from "lucide-react";
import { OrderedList, Panel, Screen, sz } from "../components/ui.tsx";
import type { LibbyCard } from "../lib/api.ts";
import { labelFor } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

function Usage({ card, kind }: { card: LibbyCard; kind: "loan" | "hold" }) {
  const used = card.counts?.[kind] ?? 0;
  const limit = card.limits?.[kind];
  const isFull = limit !== undefined && used >= limit;
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${isFull ? "font-semibold text-error" : ""}`}>
      {used} / {limit ?? "?"}
      {isFull && <TriangleAlert aria-label="Limit reached" className="size-4" />}
    </span>
  );
}

export function Cards() {
  const { cards, config, set } = useStore();
  const using = (c: LibbyCard) =>
    !config.cards.length || config.cards.includes(c.cardId) || config.cards.includes(c.cardName ?? "");
  const toggle = (c: LibbyCard, on: boolean) => {
    const next = cards.filter((x) => (x === c ? on : using(x))).map((x) => x.cardId);
    set("cards", next.length === cards.length ? undefined : next);
  };

  const keys = cards.map((c) => c.advantageKey);
  const order = [
    ...config.libraries.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !config.libraries.includes(k)),
  ];
  const nameOf = (k: string) => cards.find((c) => c.advantageKey === k)?.cardName ?? k;

  if (!cards.length)
    return (
      <Screen id="cards">
        <span className="loading loading-dots loading-lg" />
      </Screen>
    );

  return (
    <Screen id="cards">
      <Panel>
        <div className="hidden md:block">
          <table className={`table ${sz("table")}`}>
            <thead>
              <tr>
                <th className="w-12">Use</th>
                <th>Card</th>
                <th>Library key</th>
                <th>Loans</th>
                <th>Holds</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.cardId} className={using(c) ? "" : "opacity-50"}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Use ${c.cardName}`}
                      className={`checkbox checkbox-primary ${sz("checkbox")}`}
                      checked={using(c)}
                      onChange={(e) => toggle(c, e.target.checked)}
                    />
                  </td>
                  <td className="font-semibold">{c.cardName ?? c.cardId}</td>
                  <td>
                    <code className="font-mono text-sm">{c.advantageKey}</code>
                  </td>
                  <td>
                    <Usage card={c} kind="loan" />
                  </td>
                  <td>
                    <Usage card={c} kind="hold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="space-y-3 md:hidden">
          {cards.map((c) => (
            <li key={c.cardId} className={`rounded-field border-2 border-base-300 p-4 ${using(c) ? "" : "opacity-50"}`}>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold">{c.cardName ?? c.cardId}</span>
                  <code className="font-mono text-sm opacity-70">{c.advantageKey}</code>
                </span>
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary"
                  checked={using(c)}
                  onChange={(e) => toggle(c, e.target.checked)}
                />
              </label>
              <dl className="mt-3 flex gap-6 text-sm">
                <div>
                  <dt className="opacity-70">Loans</dt>
                  <dd>
                    <Usage card={c} kind="loan" />
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">Holds</dt>
                  <dd>
                    <Usage card={c} kind="hold" />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <OrderedList
          label={labelFor("cards", "libraries", "Library priority")}
          items={order}
          onChange={(next) => set("libraries", next)}
          render={(k) => (
            <>
              {nameOf(k)} <code className="font-mono text-xs opacity-70">{k}</code>
            </>
          )}
        />
      </Panel>
    </Screen>
  );
}
