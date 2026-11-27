import { type DragEvent, useState } from "react";

/** Copy of `items` with the entry at `from` moved to `to`; undefined when the move is a no-op or out of range. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] | undefined {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return undefined;
  const next = [...items];
  const [item] = next.splice(from, 1) as [T];
  next.splice(to, 0, item);
  return next;
}

export type ReorderDragProps = {
  draggable: boolean;
  onDragStart(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onDragEnd(): void;
};

/**
 * Shared move and drag-and-drop behavior for an ordered list of unique keys.
 * Only keys present in `items` can be dragged or receive drops, so callers may
 * attach `dragProps` to rows outside the ordered set.
 */
export function useReorder<K extends string>(items: readonly K[], onChange: (next: K[]) => void) {
  const [dragging, setDragging] = useState<K>();

  /** Move `key` to position `to` in `items`. */
  function moveTo(key: K, to: number) {
    const next = moveItem(items, items.indexOf(key), to);
    if (next) onChange(next);
  }

  function dragProps(key: K): ReorderDragProps {
    const movable = items.includes(key);
    return {
      draggable: movable,
      onDragStart: (e) => {
        if (!movable) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", key);
        e.dataTransfer.effectAllowed = "move";
        setDragging(key);
      },
      onDragOver: (e) => {
        if (movable) e.preventDefault();
      },
      onDrop: (e) => {
        e.preventDefault();
        if (movable && dragging !== undefined) moveTo(dragging, items.indexOf(key));
        setDragging(undefined);
      },
      onDragEnd: () => setDragging(undefined),
    };
  }

  return { dragging, moveTo, dragProps };
}
