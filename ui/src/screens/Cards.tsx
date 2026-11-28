import { GripVertical, TriangleAlert } from "lucide-react";
import { Panel, RefreshButton, ReorderControls, Screen, sz } from "../components/ui.tsx";
import type { LibbyCard } from "../lib/api.ts";
import { cardSelected, cardUsage, libraryOrder, toggleCard } from "../lib/cards.ts";
import { useStore } from "../lib/store.tsx";
import { useReorder } from "../lib/use-reorder.ts";

function Usage({ card, kind }: { card: LibbyCard; kind: "loan" | "hold" }) {
  const { used, limit, isFull } = cardUsage(card, kind);
  return (
    <span className={`inline-flex items-center gap-1.5 tabular-nums ${isFull ? "font-semibold text-error" : ""}`}>
      {used ?? "?"} / {limit ?? "?"}
      {isFull && <TriangleAlert aria-label="Limit reached" className="size-4" />}
    </span>
  );
}

export function Cards() {
  const { cards, cardsLoading, cardsError, refreshCards, config, set } = useStore();
  const using = (c: LibbyCard) => cardSelected(config.cards, c);
  const selectedCount = cards.filter(using).length;
  const toggle = (c: LibbyCard, on: boolean) => set("cards", toggleCard(cards, config.cards, c, on));
  const order = libraryOrder(cards, config.libraries);
  const enabled = order.filter((key) => cards.some((c) => c.advantageKey === key && using(c)));
  const sorted = [...cards].sort(
    (a, b) => Number(using(b)) - Number(using(a)) || order.indexOf(a.advantageKey) - order.indexOf(b.advantageKey),
  );

  const { moveTo, dragProps } = useReorder(enabled, (next) =>
    set("libraries", [...next, ...order.filter((key) => !next.includes(key))]),
  );

  /** Use this function to render descending priority and accessible reorder controls for a card using the enabled library order and `moveTo`. */
  function priority(c: LibbyCard) {
    const index = enabled.indexOf(c.advantageKey);
    const active = using(c);
    const name = c.cardName ?? c.cardId;
    return (
      <div className="inline-flex items-center gap-1">
        <GripVertical aria-hidden className={`size-4 ${active ? "cursor-grab" : "opacity-30"}`} />
        <span className="min-w-5 text-center font-semibold tabular-nums">{active ? enabled.length - index : "—"}</span>
        <ReorderControls
          name={name}
          index={index}
          count={enabled.length}
          disabled={!active}
          onMove={(to) => moveTo(c.advantageKey, to)}
        />
      </div>
    );
  }

  if (cardsLoading)
    return (
      <Screen id="cards">
        <p role="status">Loading library cards…</p>
      </Screen>
    );
  if (cardsError)
    return (
      <Screen id="cards">
        <p role="alert">Could not load cards: {cardsError}</p>
        <RefreshButton className="btn btn-primary" onClick={refreshCards}>
          Retry
        </RefreshButton>
      </Screen>
    );
  if (!cards.length)
    return (
      <Screen id="cards">
        <p>No library cards found. Connect Libby or add a card in Libby, then refresh.</p>
        <RefreshButton className="btn btn-primary" onClick={refreshCards}>
          Refresh cards
        </RefreshButton>
      </Screen>
    );

  return (
    <Screen id="cards">
      <Panel>
        <div className="mb-3 flex justify-end">
          <RefreshButton onClick={refreshCards}>Refresh cards</RefreshButton>
        </div>
        <p className="mb-3 text-sm opacity-70">
          Highest priority first. Drag a card or use the arrows. At least one card must stay selected.
        </p>
        <div className="hidden md:block">
          <table className={`table ${sz("table")}`}>
            <thead>
              <tr>
                <th className="w-12">Use</th>
                <th>Card</th>
                <th>Priority</th>
                <th>Loans</th>
                <th>Holds</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.cardId} {...dragProps(c.advantageKey)} className={using(c) ? "" : "opacity-50"}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Use ${c.cardName ?? c.cardId}`}
                      className={`checkbox checkbox-primary ${sz("checkbox")}`}
                      disabled={using(c) && selectedCount === 1}
                      checked={using(c)}
                      onChange={(e) => toggle(c, e.target.checked)}
                    />
                  </td>
                  <td className="font-semibold">{c.cardName ?? c.cardId}</td>
                  <td>{priority(c)}</td>
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
          {sorted.map((c) => (
            <li
              key={c.cardId}
              {...dragProps(c.advantageKey)}
              className={`rounded-field border-2 border-base-300 p-4 ${using(c) ? "" : "opacity-50"}`}
            >
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-semibold">{c.cardName ?? c.cardId}</span>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Use ${c.cardName ?? c.cardId}`}
                  className="checkbox checkbox-primary"
                  disabled={using(c) && selectedCount === 1}
                  checked={using(c)}
                  onChange={(e) => toggle(c, e.target.checked)}
                />
              </label>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span>Priority</span>
                {priority(c)}
              </div>
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
    </Screen>
  );
}
