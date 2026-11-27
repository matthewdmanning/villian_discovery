import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ListItem, ListQuery } from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";
import { formatTagGroups } from "../lib/list-query.ts";
import { type ListSort, sortListItems } from "../lib/list-results.ts";
import type { useLists } from "../lib/use-lists.ts";
import { ListResult } from "./ListResult.tsx";
import { QueryFields } from "./TagQueryFields.tsx";
import { Panel } from "./ui.tsx";

type Lists = ReturnType<typeof useLists>;

export function QuerySummary({ query, tags }: { query: ListQuery; tags: LibbyTag[] }) {
  return (
    <>
      <div className="min-w-0 break-words">
        <span className="text-sm font-semibold">Includes</span>
        <p>{formatTagGroups(query.includes, tags)}</p>
      </div>
      <div className="min-w-0 break-words">
        <span className="text-sm font-semibold">Exclude</span>
        <p>{formatTagGroups(query.excludes, tags)}</p>
      </div>
    </>
  );
}

export function TagFilters({ lists }: { lists: Lists }) {
  const {
    data,
    draft,
    setDraft,
    saved,
    setSaved,
    editing,
    setEditing,
    duplicate,
    setDuplicate,
    boolean,
    multiquery,
    busy,
    add,
    saveEdit,
    startEdit,
  } = lists;
  return (
    <div className="space-y-2">
      <div
        className={`grid gap-4 rounded-field border border-base-300 p-3 ${multiquery ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "grid-cols-2"}`}
      >
        <QueryFields
          tags={data?.tags ?? []}
          query={draft}
          boolean={boolean}
          onChange={(value) => {
            setDraft(value);
            setDuplicate(false);
          }}
        />
        {multiquery && (
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
            aria-label="Add query"
            disabled={busy || !data}
            onClick={add}
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {multiquery &&
        saved.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 rounded-field border border-base-300 p-3"
          >
            {editing?.id === row.id ? (
              <>
                <QueryFields
                  tags={data?.tags ?? []}
                  query={editing.query}
                  boolean={boolean}
                  onChange={(query) => {
                    setEditing({ id: row.id, query });
                    setDuplicate(false);
                  }}
                />
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
                    aria-label="Save query"
                    onClick={saveEdit}
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
                    aria-label="Cancel editing query"
                    onClick={() => {
                      setEditing(undefined);
                      setDuplicate(false);
                    }}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <QuerySummary query={row.query} tags={data?.tags ?? []} />
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
                    aria-label="Edit query"
                    onClick={() => startEdit(row)}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
                    aria-label="Remove query"
                    onClick={() => {
                      setSaved(saved.filter((entry) => entry.id !== row.id));
                      setDuplicate(false);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      {duplicate && (
        <p role="alert" className="text-xs text-error">
          Identical to an existing search
        </p>
      )}
    </div>
  );
}

export function TaggedResults({ lists, items }: { lists: Lists; items: ListItem[] }) {
  const { api, data, error, busy, revision, reload, sort, setSort } = lists;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold">Items</h2>
        <label className="flex items-center gap-2 text-sm">
          Sort{" "}
          <select
            className="select select-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value as ListSort)}
          >
            <option value="title">Title A–Z</option>
            <option value="author">Author A–Z</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={reload}>
          Refresh
        </button>
      </div>
      {busy && <p role="status">Loading…</p>}
      {error && (
        <p role="alert" className="text-error">
          Could not load items. Try refreshing.
        </p>
      )}
      {data &&
        !busy &&
        !error &&
        (items.length ? (
          <ul className="divide-y-2 divide-base-200">
            {sortListItems(items, sort).map((item) => (
              <ListResult
                key={`${revision}:${item.id}`}
                item={item}
                tags={data.tags}
                load={api.listAvailability}
                demo={api.demo}
              />
            ))}
          </ul>
        ) : (
          <p>No items found.</p>
        ))}
    </Panel>
  );
}
