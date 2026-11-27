import { useCallback, useMemo, useState } from "react";
import {
  activeListQueries,
  filterListGroups,
  filterListQueries,
  type ListQuery,
  listQueryKey,
} from "../../../src/libby-lists.ts";
import { emptyQuery, needsBoolean, simpleQuery } from "./list-query.ts";
import { type ListSort, sortListItems } from "./list-results.ts";
import { useStore } from "./store.tsx";
import { useResource } from "./use-resource.ts";

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
type SavedQuery = { id: number; query: ListQuery };
export function useLists() {
  const { api } = useStore();
  const lists = useResource(
    useCallback(() => api.lists(), [api]),
    { keepStale: true },
  );
  const { data, revision, reload, cooldown } = lists;
  const error = lists.error !== undefined;
  const busy = lists.loading;
  const [draft, setDraft] = useState<ListQuery>(emptyQuery);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [nextId, setNextId] = useState(0);
  const [editing, setEditing] = useState<{ id: number; query: ListQuery }>();
  const [duplicate, setDuplicate] = useState(false);
  const [boolean, setBoolean] = useState(() => readFlag("Boolean"));
  const [multiquery, setMultiquery] = useState(() => readFlag("multiquery"));
  const [sort, setSort] = useState<ListSort>("title");

  function changeBoolean(value: boolean) {
    if (!value) setDraft(simpleQuery(draft));
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
  const items = useMemo(
    () =>
      data
        ? multiquery && saved.length
          ? filterListQueries(
              data.items,
              activeListQueries(
                saved.map((row) => row.query),
                draft,
              ),
            )
          : filterListGroups(data.items, draft.includes, draft.excludes)
        : [],
    [data, multiquery, saved, draft],
  );
  const sorted = useMemo(() => sortListItems(items, sort), [items, sort]);
  function changeMultiquery(value: boolean) {
    setMultiquery(value);
    saveFlag("multiquery", value);
    setDuplicate(false);
    setEditing(undefined);
  }
  function startEdit(row: SavedQuery) {
    setEditing({ id: row.id, query: row.query });
    setDuplicate(false);
    if (!boolean && needsBoolean(row.query)) {
      setBoolean(true);
      saveFlag("Boolean", true);
    }
  }
  return {
    api,
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
    error,
    busy,
    revision,
    reload,
    cooldown,
    sort,
    setSort,
    items,
    sorted,
    changeBoolean,
    changeMultiquery,
    add,
    saveEdit,
    startEdit,
  };
}
