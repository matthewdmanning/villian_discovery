import { useEffect, useState } from "react";
import { filterListGroups, type ListsData, type TagGroups } from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";
import { Panel, Screen } from "../components/ui.tsx";
import { useStore } from "../lib/store.tsx";

const FLAG_KEY = "libby-shelf.feature.Boolean";
function readFlag() {
  try {
    return localStorage.getItem(FLAG_KEY) === "true";
  } catch {
    return false;
  }
}
function saveFlag(value: boolean) {
  try {
    localStorage.setItem(FLAG_KEY, String(value));
  } catch {
    /* Storage can be unavailable. */
  }
}

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

function toggle(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}
function union(groups: TagGroups): string[] {
  return [...new Set(groups.flat())];
}

export function TagsScreen() {
  const { api } = useStore();
  const [data, setData] = useState<ListsData>();
  const [includes, setIncludes] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [includeGroups, setIncludeGroups] = useState<TagGroups>([[]]);
  const [excludeGroups, setExcludeGroups] = useState<TagGroups>([[]]);
  const [boolean, setBoolean] = useState(readFlag);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);

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
          const ids = new Set(result.tags.map((tag) => tag.uuid));
          setIncludes((current) => current.filter((id) => ids.has(id)));
          setExcludes((current) => current.filter((id) => ids.has(id)));
          setIncludeGroups((current) => current.map((group) => group.filter((id) => ids.has(id))));
          setExcludeGroups((current) => current.map((group) => group.filter((id) => ids.has(id))));
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

  function changeFlag(value: boolean) {
    if (value) {
      setIncludeGroups([includes]);
      setExcludeGroups(excludes.length ? excludes.map((id) => [id]) : [[]]);
    } else {
      setIncludes(union(includeGroups));
      setExcludes(union(excludeGroups));
    }
    setBoolean(value);
    saveFlag(value);
  }
  const items = data
    ? filterListGroups(
        data.items,
        boolean ? includeGroups : [includes],
        boolean ? excludeGroups : excludes.map((id) => [id]),
      )
    : [];
  return (
    <Screen id="tags">
      <Panel className="space-y-5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={boolean}
            onChange={(event) => changeFlag(event.target.checked)}
          />{" "}
          Boolean
        </label>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["Includes", includes, setIncludes, includeGroups, setIncludeGroups],
              ["Exclude", excludes, setExcludes, excludeGroups, setExcludeGroups],
            ] as const
          ).map(([label, selected, setSelected, groups, setGroups]) => (
            <fieldset key={label} className="min-w-0 space-y-2">
              <legend className="font-semibold">{label}</legend>
              {data && !data.tags.length && <p className="text-sm opacity-70">No tags</p>}
              {boolean ? (
                <>
                  {groups.map((group, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: groups have no independent component state.
                    <div key={index} className="space-y-1 rounded-field bg-base-200 p-2">
                      {index > 0 && <p className="text-sm font-semibold">OR</p>}
                      <p className="text-sm">All selected tags (AND)</p>
                      <TagChoices
                        tags={data?.tags ?? []}
                        selected={group}
                        onToggle={(id) =>
                          setGroups(groups.map((value, i) => (i === index ? toggle(value, id) : value)))
                        }
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
                  tags={data?.tags ?? []}
                  selected={selected}
                  onToggle={(id) => setSelected(toggle(selected, id))}
                />
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t-2 border-base-200 pt-4">
          <h2 className="text-lg font-semibold">Items</h2>
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
              {items.map((item) => (
                <li key={item.id} className="py-3">
                  <p className="font-semibold">{item.title}</p>
                  {item.author && <p className="text-sm opacity-70">{item.author}</p>}
                  <p className="text-sm opacity-70">
                    {data.tags
                      .filter((tag) => item.tags.includes(tag.uuid))
                      .map((tag) => tag.name)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No items found.</p>
          ))}
      </Panel>
    </Screen>
  );
}
