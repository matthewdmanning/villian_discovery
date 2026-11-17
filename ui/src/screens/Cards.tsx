import { ChevronDown, ChevronUp, GripVertical, TriangleAlert } from "lucide-react";
import { type DragEvent, useState } from "react";
import { Panel, Screen, sz } from "../components/ui.tsx";
import type { LibbyCard } from "../lib/api.ts";
import { cardSelected, libraryOrder, toggleCard } from "../lib/cards.ts";
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
  const { cards, cardsLoading, cardsError, refreshCards, config, set } = useStore();
  const [dragging, setDragging] = useState<string>();
  const using = (c: LibbyCard) => cardSelected(config.cards, c);
  const selectedCount = cards.filter(using).length;
  const toggle = (c: LibbyCard, on: boolean) => set("cards", toggleCard(cards, config.cards, c, on));
  const order = libraryOrder(cards, config.libraries);
  const enabled = order.filter((key) => cards.some((c) => c.advantageKey === key && using(c)));
  const sorted = [...cards].sort(
    (a, b) => Number(using(b)) - Number(using(a)) || order.indexOf(a.advantageKey) - order.indexOf(b.advantageKey),
  );

  /** Use this function to move an enabled library from one priority position to another using `enabled`, `order`, and the config setter. */
  function move(from: string, to: string) {
    const start = enabled.indexOf(from);
    const end = enabled.indexOf(to);
    if (start < 0 || end < 0 || start === end) return;
    const next = [...enabled];
    next.splice(start, 1);
    next.splice(end, 0, from);
    set("libraries", [...next, ...order.filter((key) => !next.includes(key))]);
  }

  /** Use this function to attach drag behavior to a card row; disabled cards cannot start or receive moves through `move`. */
  function dragProps(c: LibbyCard) {
    return {
      draggable: using(c),
      onDragStart: (e: DragEvent) => {
        if (!using(c)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", c.advantageKey);
        e.dataTransfer.effectAllowed = "move";
        setDragging(c.advantageKey);
      },
      onDragOver: (e: DragEvent) => {
        if (using(c)) e.preventDefault();
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (using(c) && dragging) move(dragging, c.advantageKey);
        setDragging(undefined);
      },
      onDragEnd: () => setDragging(undefined),
    };
  }

  /** Use this function to render descending priority and accessible reorder controls for a card using the enabled library order and `move`. */
  function priority(c: LibbyCard) {
    const index = enabled.indexOf(c.advantageKey);
    const active = using(c);
    const name = c.cardName ?? c.cardId;
    return (
      <div className="inline-flex items-center gap-1">
        <GripVertical aria-hidden className={`size-4 ${active ? "cursor-grab" : "opacity-30"}`} />
        <span className="min-w-5 text-center font-semibold tabular-nums">{active ? enabled.length - index : "—"}</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          aria-label={`Move ${name} up`}
          disabled={!active || index <= 0}
          onClick={() => move(c.advantageKey, enabled[index - 1]!)}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square"
          aria-label={`Move ${name} down`}
          disabled={!active || index >= enabled.length - 1}
          onClick={() => move(c.advantageKey, enabled[index + 1]!)}
        >
          <ChevronDown className="size-4" />
        </button>
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
        <button type="button" className="btn btn-primary" onClick={refreshCards}>
          Retry
        </button>
      </Screen>
    );
  if (!cards.length)
    return (
      <Screen id="cards">
        <p>No library cards found. Connect Libby or add a card in Libby, then refresh.</p>
        <button type="button" className="btn btn-primary" onClick={refreshCards}>
          Refresh cards
        </button>
      </Screen>
    );

  return (
    <Screen id="cards">
      <Panel>
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
                <tr key={c.cardId} {...dragProps(c)} className={using(c) ? "" : "opacity-50"}>
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
              {...dragProps(c)}
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
