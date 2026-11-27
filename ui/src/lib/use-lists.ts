import { useEffect, useState } from "react";
import {
  activeListQueries,
  filterListGroups,
  filterListQueries,
  type ListQuery,
  type ListsData,
  listQueryKey,
} from "../../../src/libby-lists.ts";
import { emptyQuery, needsBoolean, simpleQuery } from "./list-query.ts";
import type { ListSort } from "./list-results.ts";
import { useStore } from "./store.tsx";

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
    setRevision,
    sort,
    setSort,
    items,
    changeBoolean,
    changeMultiquery,
    add,
    saveEdit,
    startEdit,
  };
}
