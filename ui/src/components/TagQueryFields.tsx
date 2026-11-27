import { Tag, X } from "lucide-react";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import type { ListQuery, TagGroups } from "../../../src/libby-lists.ts";
import type { LibbyTag } from "../../../src/libby-tags-cache.ts";
import { toggleTag, unionTags } from "../lib/list-query.ts";

type QueryFieldsProps = {
  tags: LibbyTag[];
  query: ListQuery;
  boolean: boolean;
  onChange(query: ListQuery): void;
};

/** Tag filters for the current or saved search. */
export function QueryFields({ tags, query, boolean, onChange }: QueryFieldsProps) {
  const [picker, setPicker] = useState<{ key: "includes" | "excludes"; group: number }>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pickerId = useId();
  const closePicker = () => {
    setPicker(undefined);
    queueMicrotask(() => trigger.current?.focus());
  };

  // A tag can occur in only one include/exclude group in a query. Keeping this
  // derived from the query also handles queries loaded from older saved data.
  const used = new Set([...unionTags(query.includes), ...unionTags(query.excludes)]);

  return (
    <>
      {(
        [
          ["Includes", "includes"],
          ["Exclude", "excludes"],
        ] as const
      ).map(([label, key]) => {
        const groups = query[key];
        const displayGroups = groups.length ? groups : [[]];
        const setGroups = (next: TagGroups) => onChange({ ...query, [key]: next });
        const selected = unionTags(groups);

        return (
          <fieldset key={key} className="min-w-0 space-y-2">
            <legend className="font-semibold">{label}</legend>
            {!tags.length && <p className="text-sm opacity-70">No tags</p>}
            {boolean ? (
              <>
                {displayGroups.map((group, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: groups have no independent component state.
                  <div key={index} className="space-y-2 rounded-field bg-base-200 p-2">
                    {index > 0 && <p className="text-sm font-semibold">OR</p>}
                    <p className="text-sm">All selected tags (AND)</p>
                    <SelectedTags
                      tags={tags}
                      selected={group}
                      onRemove={(id) =>
                        setGroups(groups.map((value, i) => (i === index ? toggleTag(value, id) : value)))
                      }
                    />
                    <PickerButton
                      label={label}
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setPicker({ key, group: index });
                      }}
                      disabled={!tags.length}
                    />
                    {groups.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-11"
                        onClick={() => setGroups(groups.filter((_, i) => i !== index))}
                      >
                        Remove group
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setGroups([...displayGroups, []])}
                >
                  Add OR group
                </button>
              </>
            ) : (
              <>
                <SelectedTags
                  tags={tags}
                  selected={selected}
                  onRemove={(id) => {
                    const next = toggleTag(selected, id);
                    setGroups(key === "includes" ? [next] : next.length ? next.map((tag) => [tag]) : [[]]);
                  }}
                />
                <PickerButton
                  label={label}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setPicker({ key, group: 0 });
                  }}
                  disabled={!tags.length}
                />
              </>
            )}
          </fieldset>
        );
      })}
      {picker && (
        <TagPicker
          id={pickerId}
          label={picker.key === "includes" ? "Includes" : "Exclude"}
          tags={tags.filter((tag) => !used.has(tag.uuid))}
          onSelect={(id) => {
            const groups = query[picker.key];
            const index = boolean ? picker.group : 0;
            const next =
              !boolean && picker.key === "excludes"
                ? [...groups.filter((group) => group.length), [id]]
                : groups.length
                  ? groups.map((group, i) => (i === index ? [...group, id] : group))
                  : [[id]];
            onChange({ ...query, [picker.key]: next });
          }}
          onClose={closePicker}
        />
      )}
    </>
  );
}

function SelectedTags({
  tags,
  selected,
  onRemove,
}: {
  tags: LibbyTag[];
  selected: string[];
  onRemove(id: string): void;
}) {
  const names = new Map(tags.map((tag) => [tag.uuid, tag.name]));
  return selected.length ? (
    <ul className="flex flex-wrap gap-2" aria-label="Selected tags">
      {selected.map((id) => (
        <li key={id} className="badge badge-lg h-auto max-w-full gap-1">
          <span className="min-w-0 wrap-anywhere">{names.get(id) ?? id}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            aria-label={`Remove ${names.get(id) ?? id}`}
            onClick={() => onRemove(id)}
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm opacity-70">No tags selected</p>
  );
}

function PickerButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick(event: MouseEvent<HTMLButtonElement>): void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm min-h-11 gap-2"
      aria-label={`Add tag to ${label}`}
      aria-haspopup="dialog"
      onClick={onClick}
      disabled={disabled}
    >
      <Tag className="size-4" aria-hidden="true" />
      Add tag
    </button>
  );
}

function TagPicker({
  id,
  label,
  tags,
  onSelect,
  onClose,
}: {
  id: string;
  label: string;
  tags: LibbyTag[];
  onSelect(id: string): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && typeof node.showModal === "function" && !node.open) node.showModal();
  }, []);

  const nativeModal =
    typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal === "function";

  return (
    <dialog
      ref={dialog}
      open={!nativeModal}
      className="modal modal-bottom sm:modal-middle"
      aria-labelledby={id}
      aria-modal="true"
      onCancel={onClose}
    >
      <div className="modal-box space-y-3 border-2 border-pop shadow-pop">
        <h3 id={id} className="text-xl font-semibold">
          Add tag to {label}
        </h3>
        {tags.length ? (
          <div className="grid max-h-72 gap-1 overflow-y-auto">
            {tags.map((tag) => (
              <button
                key={tag.uuid}
                type="button"
                className="btn btn-ghost min-h-11 justify-start"
                onClick={() => onSelect(tag.uuid)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm opacity-70">No available tags</p>
        )}
        <div className="modal-action">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" aria-label="Close tag picker" onClick={onClose} />
    </dialog>
  );
}
