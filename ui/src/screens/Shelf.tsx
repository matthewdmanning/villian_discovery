import { BookOpen, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, Panel, Screen } from "../components/ui.tsx";
import type { ShelfData, ShelfEntry, ShelfTab } from "../lib/api.ts";
import { useStore } from "../lib/store.tsx";

const TABS = [
  ["checkedOut", "Checked out"],
  ["holds", "Holds"],
  ["returned", "Returned"],
] as const satisfies ReadonlyArray<[keyof ShelfData, string]>;

function ShelfRows({ items, kind }: { items: ShelfEntry[]; kind: "checkedOut" | "holds" | "returned" }) {
  if (!items.length)
    return (
      <Empty
        icon={<BookOpen className="size-7" />}
        title={kind === "holds" ? "No holds" : kind === "returned" ? "No returned titles" : "Nothing checked out"}
      />
    );
  return (
    <ul className="divide-y-2 divide-base-200">
      {items.map((item) => (
        <li
          key={`${item.cardId}:${item.id}`}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4"
        >
          <div className="min-w-0">
            <p className="font-semibold">{item.title}</p>
            {item.author && <p className="text-sm opacity-70">{item.author}</p>}
            {item.narrators?.length ? (
              <p className="text-sm opacity-70">Narrated by {item.narrators.join(", ")}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-3 text-sm opacity-70">
            <span>{item.cardName ?? item.cardId}</span>
            {item.mediaType && <span>{item.mediaType}</span>}
            {item.holdListPosition !== undefined && <span>#{item.holdListPosition} in line</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TabContent({ tab, kind }: { tab: ShelfTab; kind: "checkedOut" | "holds" | "returned" }) {
  if (tab.status === "unavailable") {
    return (
      <div role="status" className="rounded-box border-2 border-dashed border-base-300 px-6 py-10 text-center">
        <p className="font-display text-lg font-semibold">
          {kind === "returned" ? "Returned titles are unavailable" : "Shelf data is unavailable"}
        </p>
        <p className="mt-2 text-sm opacity-70">{tab.reason}</p>
      </div>
    );
  }
  return <ShelfRows items={tab.items} kind={kind} />;
}

/** Show Libby's verified current loans and holds; returned history is labeled unavailable until its source is verified. */
export function Shelf() {
  const { api } = useStore();
  const [active, setActive] = useState<(typeof TABS)[number][0]>("checkedOut");
  const [data, setData] = useState<ShelfData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally triggers an explicit shelf reload.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    api.shelf().then(
      (next) => {
        if (!cancelled) {
          setData(next);
          setLoading(false);
        }
      },
      (reason) => {
        if (!cancelled) {
          setData(undefined);
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, revision]);

  return (
    <Screen id="shelf">
      {loading && <p role="status">Loading shelf…</p>}
      {!loading && error && (
        <div className="space-y-3" role="alert">
          <p>Could not load shelf: {error}</p>
          <button type="button" className="btn btn-primary" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw className="size-4" /> Retry
          </button>
        </div>
      )}
      {!loading && !error && data && (
        <Panel>
          <div
            role="tablist"
            aria-label="Shelf sections"
            className="tabs tabs-box mb-4 w-fit max-w-full overflow-x-auto"
          >
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                className={`tab whitespace-nowrap ${active === key ? "tab-active" : ""}`}
                onClick={() => setActive(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <TabContent tab={data[active]} kind={active} />
        </Panel>
      )}
    </Screen>
  );
}
