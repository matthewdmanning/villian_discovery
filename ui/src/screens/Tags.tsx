import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  activeListQueries,
  filterListGroups,
  filterListQueries,
  type ListQuery,
  type ListsData,
  listQueryKey,
  type TagGroups,
} from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";
import { ListResult, type ListSort, sortListItems } from "../components/ListResult.tsx";
import { Panel, Screen } from "../components/ui.tsx";
import { useStore } from "../lib/store.tsx";

function readFlag(name: string) {
  try {
    return localStorage.getItem(`libby-shelf.feature.${name}`) === "true";
  } catch {
    return false;
  }
}
function saveFlag(name: string, value: boolean) {
  try {
    localStorage.setItem(`libby-shelf.feature.${name}`, String(value));
  } catch {
    /* Storage can be unavailable. */
  }
}
const emptyQuery = (): ListQuery => ({ includes: [[]], excludes: [[]] });
const toggle = (selected: string[], id: string) =>
  selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
const union = (groups: TagGroups) => [...new Set(groups.flat())];

export function TagChoices({
  tags,
  selected,
  onToggle,
}: {
  tags: LibbyTag[];
  selected: string[];
  onToggle(id: string): void;
}) {
  return (
    <>
      {tags.map((tag) => (
        <label key={tag.uuid} className="flex items-center gap-2 py-1">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={selected.includes(tag.uuid)}
            onChange={() => onToggle(tag.uuid)}
          />
          <span className="break-words">{tag.name}</span>
        </label>
      ))}
    </>
  );
}

export function QueryFields({
  tags,
  query,
  boolean,
  onChange,
}: {
  tags: LibbyTag[];
  query: ListQuery;
  boolean: boolean;
  onChange(query: ListQuery): void;
}) {
  return (
    <>
      {(
        [
          ["Includes", "includes"],
          ["Exclude", "excludes"],
        ] as const
      ).map(([label, key]) => {
        const groups = query[key];
        const setGroups = (next: TagGroups) => onChange({ ...query, [key]: next });
        const selected = union(groups);
        return (
          <fieldset key={key} className="min-w-0 space-y-2">
            <legend className="font-semibold">{label}</legend>
            {!tags.length && <p className="text-sm opacity-70">No tags</p>}
            {boolean ? (
              <>
                {groups.map((group, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: groups have no independent component state.
                  <div key={index} className="space-y-1 rounded-field bg-base-200 p-2">
                    {index > 0 && <p className="text-sm font-semibold">OR</p>}
                    <p className="text-sm">All selected tags (AND)</p>
                    <TagChoices
                      tags={tags}
                      selected={group}
                      onToggle={(id) => setGroups(groups.map((value, i) => (i === index ? toggle(value, id) : value)))}
                    />
                    {groups.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setGroups(groups.filter((_, i) => i !== index))}
                      >
                        Remove group
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGroups([...groups, []])}>
                  Add OR group
                </button>
              </>
            ) : (
              <TagChoices
                tags={tags}
                selected={selected}
                onToggle={(id) => {
                  const next = toggle(selected, id);
                  setGroups(key === "includes" ? [next] : next.length ? next.map((tag) => [tag]) : [[]]);
                }}
              />
            )}
          </fieldset>
        );
      })}
    </>
  );
}

export function QuerySummary({ query, tags }: { query: ListQuery; tags: LibbyTag[] }) {
  const names = new Map(tags.map((tag) => [tag.uuid, tag.name]));
  function format(groups: TagGroups) {
    const parts = groups.map((group) => group.map((id) => names.get(id) ?? id).join(" AND ")).filter(Boolean);
    return parts.length
      ? parts.map((part) => (parts.length > 1 && part.includes(" AND ") ? `(${part})` : part)).join(" OR ")
      : "—";
  }
  return (
    <>
      <div className="min-w-0 break-words">
        <span className="text-sm font-semibold">Includes</span>
        <p>{format(query.includes)}</p>
      </div>
      <div className="min-w-0 break-words">
        <span className="text-sm font-semibold">Exclude</span>
        <p>{format(query.excludes)}</p>
      </div>
    </>
  );
}

type SavedQuery = { id: number; query: ListQuery };
export function TagsScreen() {
  const { api } = useStore();
  const [data, setData] = useState<ListsData>();
  const [draft, setDraft] = useState<ListQuery>(emptyQuery);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [nextId, setNextId] = useState(0);
  const [editing, setEditing] = useState<{ id: number; query: ListQuery }>();
  const [duplicate, setDuplicate] = useState(false);
  const [boolean, setBoolean] = useState(() => readFlag("Boolean"));
  const [multiquery, setMultiquery] = useState(() => readFlag("multiquery"));
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [sort, setSort] = useState<ListSort>("title");

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision triggers a refresh.
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(false);
    api
      .lists()
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);

  function changeBoolean(value: boolean) {
    if (!value) setDraft({ includes: [union(draft.includes)], excludes: union(draft.excludes).map((id) => [id]) });
    setEditing(undefined);
    setDuplicate(false);
    setBoolean(value);
    saveFlag("Boolean", value);
  }
  function add() {
    if (saved.some((row) => listQueryKey(row.query) === listQueryKey(draft))) {
      setDuplicate(true);
      return;
    }
    setSaved([...saved, { id: nextId, query: draft }]);
    setNextId(nextId + 1);
    setDraft(emptyQuery());
    setDuplicate(false);
  }
  function saveEdit() {
    if (!editing) return;
    if (saved.some((row) => row.id !== editing.id && listQueryKey(row.query) === listQueryKey(editing.query))) {
      setDuplicate(true);
      return;
    }
    setSaved(saved.map((row) => (row.id === editing.id ? { ...row, query: editing.query } : row)));
    setEditing(undefined);
    setDuplicate(false);
  }
  const items = data
    ? multiquery && saved.length
      ? filterListQueries(
          data.items,
          activeListQueries(
            saved.map((row) => row.query),
            draft,
          ),
        )
      : filterListGroups(data.items, draft.includes, draft.excludes)
    : [];
  return (
    <Screen id="tags">
      <Panel className="space-y-5">
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["Boolean", boolean, changeBoolean],
              [
                "multiquery",
                multiquery,
                (value: boolean) => {
                  setMultiquery(value);
                  saveFlag("multiquery", value);
                  setDuplicate(false);
                  setEditing(undefined);
                },
              ],
            ] as const
          ).map(([label, checked, set]) => (
            <label key={label} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={checked}
                onChange={(event) => set(event.target.checked)}
              />{" "}
              {label}
            </label>
          ))}
        </div>
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
                className="btn btn-ghost btn-square btn-sm"
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
                        className="btn btn-ghost btn-square btn-sm"
                        aria-label="Save query"
                        onClick={saveEdit}
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-square btn-sm"
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
                        className="btn btn-ghost btn-square btn-sm"
                        aria-label="Edit query"
                        onClick={() => {
                          setEditing({ id: row.id, query: row.query });
                          setDuplicate(false);
                          if (
                            !boolean &&
                            (row.query.includes.filter((group) => group.length > 0).length > 1 ||
                              row.query.excludes.some((group) => group.length > 1))
                          ) {
                            setBoolean(true);
                            saveFlag("Boolean", true);
                          }
                        }}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-square btn-sm"
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
        <div className="flex items-center justify-between gap-3 border-t-2 border-base-200 pt-4">
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
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
    </Screen>
  );
}
