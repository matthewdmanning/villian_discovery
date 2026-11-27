import { ChevronDown, Clock, CreditCard, Plus } from "lucide-react";
import { useState } from "react";
import type { ListLibraryAvailability } from "../../../src/libby-list-availability.ts";
import type { ListItem } from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";
import { libbyTitleUrl, listLibraryDetails } from "../lib/list-results.ts";

export function LibraryRows({
  rows,
  titleId,
  demo,
}: {
  rows: ListLibraryAvailability[];
  titleId: string;
  demo: boolean;
}) {
  if (!rows.length) return <p className="py-2 text-sm">No library cards found.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm w-full">
        <thead>
          <tr>
            <th>Library</th>
            <th>
              Available
              <br />
              <span className="font-normal">Checked out / Total</span>
            </th>
            <th>Holds</th>
            <th>Est. Wait</th>
            <th>Checkout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, status, media }) => {
            const { checkedOut, action } = listLibraryDetails({ card, status, ...(media ? { media } : {}) });
            const url = libbyTitleUrl(card.advantageKey, titleId);
            return (
              <tr key={card.cardId}>
                <th scope="row">
                  <span>{card.library?.name ?? card.advantageKey}</span>
                  {card.cardName && <span className="block text-xs font-normal opacity-70">{card.cardName}</span>}
                  {status !== "ok" && (
                    <span className="block text-xs font-normal opacity-70">
                      {status === "not-offered" ? "Not offered" : "Could not load"}
                    </span>
                  )}
                </th>
                <td>{status === "ok" ? `${checkedOut ?? "—"} / ${media?.ownedCopies ?? "—"}` : "—"}</td>
                <td>{status === "ok" ? (media?.holdsCount ?? "—") : "—"}</td>
                <td>
                  {status === "ok" && typeof media?.estimatedWaitDays === "number"
                    ? `${media.estimatedWaitDays} days`
                    : "—"}
                </td>
                <td>
                  {action ? (
                    demo ? (
                      <span className="text-sm opacity-70">Demo</span>
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        aria-label={`${action} at ${card.library?.name ?? card.advantageKey} in Libby`}
                      >
                        <CreditCard className="size-4" />
                        {action === "Borrow" ? <Plus className="size-3" /> : <Clock className="size-3" />}
                      </a>
                    )
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ListResult({
  item,
  tags,
  load,
  demo,
}: {
  item: ListItem;
  tags: LibbyTag[];
  load(id: string): Promise<ListLibraryAvailability[]>;
  demo: boolean;
}) {
  const [rows, setRows] = useState<ListLibraryAvailability[]>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function fetchRows() {
    setLoading(true);
    setFailed(false);
    try {
      setRows(await load(item.id));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <li>
      <details
        className="group"
        onToggle={(event) => {
          if (event.currentTarget.open && !rows && !loading && !failed) void fetchRows();
        }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-field py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{item.title}</span>
            {item.author && <span className="block text-sm opacity-70">{item.author}</span>}
            <span className="block text-sm opacity-70">
              {tags
                .filter((tag) => item.tags.includes(tag.uuid))
                .map((tag) => tag.name)
                .join(" · ")}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
        </summary>
        {loading && (
          <p role="status" className="py-2">
            Loading libraries…
          </p>
        )}
        {failed && (
          <p role="alert" className="py-2">
            Could not load libraries.{" "}
            <button type="button" className="link" onClick={() => void fetchRows()}>
              Retry
            </button>
          </p>
        )}
        {rows && <LibraryRows rows={rows} titleId={item.id} demo={demo} />}
      </details>
    </li>
  );
}
