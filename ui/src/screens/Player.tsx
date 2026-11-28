import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  BookmarkPlus,
  Check,
  ChevronDown,
  FastForward,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  Save,
  SkipBack,
  SkipForward,
  Tag,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Empty, Panel, Screen, sz } from "../components/ui.tsx";
import { useIsPhone } from "../lib/layout.ts";
import {
  type Bookmark,
  chapterAt,
  chapterEnd,
  clampRate,
  clipTag,
  createPlayer,
  DEMO_AUDIOBOOK,
  formatRate,
  formatTime,
  hasTag,
  MAX_NOTE_LENGTH,
  MAX_RATE,
  MIN_RATE,
  normalizeTag,
  type PlayerAction,
  type PlayerState,
  playerReducer,
  restoreBookmarks,
  restoreTagLibrary,
  sameBookmarkData,
} from "../lib/player.ts";
import { labelForAction } from "../lib/spec.ts";

const KEY = "libby-shelf.player";
/** Clock step while playing. The demo advances position; no audio element plays. */
const TICK_MS = 250;

/** Restores position, speed and bookmarks for the demo title; always starts paused. */
function load(): PlayerState {
  const fresh = createPlayer(DEMO_AUDIOBOOK);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PlayerState> | null;
    if (!saved) return fresh;
    const bookmarks = restoreBookmarks(fresh.book, saved.bookmarks);
    const tagLibrary = restoreTagLibrary(saved.tagLibrary, bookmarks);
    const state = { ...fresh, bookmarks, tagLibrary, rate: clampRate(saved.rate) };
    return playerReducer(state, { type: "seek", position: Number(saved.position) || 0 });
  } catch {
    return fresh;
  }
}

function Control(props: {
  action: PlayerAction["type"];
  spec: string;
  fallback: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
  dispatch(a: PlayerAction): void;
}) {
  const label = labelForAction("player", props.spec, props.fallback);
  const Icon = props.icon;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={props.disabled}
      className={`btn btn-pop btn-circle ${sz("btn")}`}
      onClick={() => props.dispatch({ type: props.action } as PlayerAction)}
    >
      <Icon className="size-5" />
    </button>
  );
}

/**
 * Tag picker for one bookmark. Lists library tags (scrollable, checked when applied; click toggles).
 * "New Tag" stays pinned last, outside the scroll area, and is the only way to create a tag.
 */
function TagMenu(props: { mark: Bookmark; library: string[]; dispatch(a: PlayerAction): void }) {
  const { mark, library, dispatch } = props;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const at = formatTime(mark.position);

  const close = useCallback(() => {
    setOpen(false);
    setCreating(false);
    setName("");
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    // Escape leaves "New Tag" entry first, then closes the menu.
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (creating) setCreating(false);
      else close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, creating, close]);

  const [up, setUp] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  // Opens upward when the space below (above the mobile dock, if shown) can't fit the menu, so "New Tag" stays visible.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the menu grows, switches to name entry, or chips move the button.
  useLayoutEffect(() => {
    if (!open || !root.current || !menu.current) return;
    const anchor = root.current.getBoundingClientRect();
    const dock = document.querySelector("nav.dock")?.getBoundingClientRect();
    const floor = dock && dock.height > 0 ? Math.min(dock.top, innerHeight) : innerHeight;
    const need = menu.current.offsetHeight + 8;
    const below = floor - anchor.bottom;
    setUp(below < need && anchor.top > below);
    // Right-align to the button when a left-aligned menu would cross the 16px page gutter.
    setAlignEnd(anchor.left + menu.current.offsetWidth > document.documentElement.clientWidth - 16);
  }, [open, creating, library.length, mark.tags.length]);

  const create = () => {
    if (!normalizeTag(name)) return;
    dispatch({ type: "createTag", name, id: mark.id });
    setCreating(false);
    setName("");
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Tags for bookmark at ${at}`}
        className={`btn btn-ghost btn-sm gap-1 ${sz("btn")}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Tag className="size-4" />
        Add tag
        <ChevronDown className="size-4" />
      </button>
      {open && (
        <div
          id={menuId}
          ref={menu}
          role="menu"
          aria-label={`Tags for bookmark at ${at}`}
          className={`surface absolute z-30 flex w-60 flex-col p-1 ${alignEnd ? "end-0" : "start-0"} ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          <ul className="max-h-48 overflow-y-auto overscroll-contain">
            {library.length === 0 && <li className="px-3 py-2 text-sm opacity-70">No tags yet</li>}
            {library.map((t) => {
              const on = hasTag(mark, t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className="flex min-h-10 w-full items-center gap-2 rounded-field px-3 text-start hover:bg-base-200"
                    onClick={() => dispatch({ type: on ? "bookmarkUntag" : "bookmarkTag", id: mark.id, tag: t })}
                  >
                    <Check className={`size-4 shrink-0 ${on ? "" : "invisible"}`} />
                    <span className="truncate">{t}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t-2 border-base-200 pt-1">
            {creating ? (
              <form
                className="flex gap-1 p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  create();
                }}
              >
                <input
                  // biome-ignore lint/a11y/noAutofocus: the user just chose "New Tag"; typing is the next step.
                  autoFocus
                  type="text"
                  aria-label="New tag name"
                  placeholder="Tag name"
                  autoComplete="off"
                  className={`input input-sm min-w-0 flex-1`}
                  value={name}
                  // Clipping by character, not `maxLength`'s UTF-16 units, leaves room for emoji.
                  onChange={(e) => setName(clipTag(e.target.value))}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!normalizeTag(name)}>
                  Add
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-10 w-full items-center gap-2 rounded-field px-3 font-semibold text-start hover:bg-base-200"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                {labelForAction("player", "player-new-tag", "New Tag")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One bookmark: jump to it, write a note, pick tags from the bookmark tag library. */
function BookmarkItem(props: { mark: Bookmark; chapter: string; library: string[]; dispatch(a: PlayerAction): void }) {
  const { mark, dispatch } = props;
  const noteId = useId();
  return (
    <li className="space-y-2 py-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-field px-2 text-start hover:bg-base-200"
        onClick={() => dispatch({ type: "seek", position: mark.position })}
      >
        <span className="truncate font-semibold">{props.chapter}</span>
        <span className="tabular-nums opacity-80">{formatTime(mark.position)}</span>
      </button>
      <label htmlFor={noteId} className="sr-only">
        Note for bookmark at {formatTime(mark.position)}
      </label>
      <textarea
        id={noteId}
        className={`textarea w-full ${sz("textarea")}`}
        rows={2}
        placeholder="Add a note…"
        maxLength={MAX_NOTE_LENGTH}
        value={mark.note}
        onChange={(e) => dispatch({ type: "bookmarkNote", id: mark.id, note: e.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        {mark.tags.map((t) => (
          <span key={t} className="badge gap-1 border-2 border-secondary bg-base-100 font-semibold">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t} from bookmark at ${formatTime(mark.position)}`}
              className="cursor-pointer"
              onClick={() => dispatch({ type: "bookmarkUntag", id: mark.id, tag: t })}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <TagMenu mark={mark} library={props.library} dispatch={dispatch} />
      </div>
    </li>
  );
}

function AddBookmark({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className={`btn btn-pop btn-secondary ${sz("btn")}`} onClick={onClick}>
      <BookmarkPlus className="size-4" />
      {labelForAction("player", "player-bookmark", "Add bookmark")}
    </button>
  );
}

/** Tag filter and bookmark rows. `dispatch` is the live player on desktop, a draft on the phone sheet. */
function BookmarkList({ state, dispatch }: { state: PlayerState; dispatch(a: PlayerAction): void }) {
  const tags = state.tagLibrary;
  const [picked, setFilter] = useState<string>();
  // A filter whose tag no longer exists shows everything.
  const filter = picked !== undefined && tags.includes(picked) ? picked : undefined;
  const shown = filter ? state.bookmarks.filter((b) => hasTag(b, filter)) : state.bookmarks;
  if (state.bookmarks.length === 0)
    return <Empty icon={<BookmarkPlus className="size-6" />} title="No bookmarks yet" />;
  return (
    <>
      {tags.length > 0 && (
        <fieldset className="mb-2 flex flex-wrap items-center gap-2">
          <legend className="sr-only">Filter by tag</legend>
          {[undefined, ...tags].map((t) => (
            <button
              key={t ?? ""}
              type="button"
              aria-pressed={filter === t}
              className={`btn btn-xs rounded-full ${filter === t ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(t)}
            >
              {t ?? "All"}
            </button>
          ))}
        </fieldset>
      )}
      <ul className="divide-y-2 divide-base-200">
        {shown.map((b) => (
          <BookmarkItem
            key={b.id}
            mark={b}
            chapter={state.book.chapters[b.chapter]?.title ?? ""}
            library={tags}
            dispatch={dispatch}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * Phone: bookmarks open full screen over the player. Edits are a draft until Save.
 * Back (header arrow or the system back gesture) asks before discarding unsaved edits.
 * Save and Discard both return to the player. Seeking from a row acts on the live player.
 */
function BookmarkSheet(props: { live: PlayerState; liveDispatch(a: PlayerAction): void; onClose(): void }) {
  const { live, liveDispatch, onClose } = props;
  const [draft, draftDispatch] = useReducer(playerReducer, live);
  const dirty = !sameBookmarkData(draft, live);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const closing = useRef(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const confirmId = useId();

  const dispatch = (a: PlayerAction) => {
    if (a.type === "seek") liveDispatch(a);
    // New bookmarks use the live position; the draft's copy went stale when the sheet opened.
    else if (a.type === "bookmark") {
      draftDispatch({ type: "seek", position: live.position });
      draftDispatch(a);
    } else draftDispatch(a);
  };

  // The sheet owns one history entry, so the system back gesture comes here instead of leaving the app.
  useEffect(() => {
    history.pushState({ playerSheet: true }, "");
    const onPop = () => {
      if (closing.current || !dirtyRef.current) {
        onClose();
        return;
      }
      // Unsaved edits: restore the entry and ask.
      history.pushState({ playerSheet: true }, "");
      if (!confirm.current?.open) confirm.current?.showModal();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    addEventListener("popstate", onPop);
    addEventListener("beforeunload", onUnload);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    back.current?.focus();
    return () => {
      removeEventListener("popstate", onPop);
      removeEventListener("beforeunload", onUnload);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  /** Leaves through history so the sheet's entry is consumed; `onPop` then closes. */
  const leave = () => {
    closing.current = true;
    history.back();
  };
  const requestBack = () => {
    if (dirty) confirm.current?.showModal();
    else leave();
  };
  const save = () => {
    if (dirty) liveDispatch({ type: "setBookmarks", bookmarks: draft.bookmarks, tagLibrary: draft.tagLibrary });
    leave();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col bg-base-100"
    >
      <header className="flex items-center gap-2 border-b-2 border-pop pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 px-safe">
        <button
          ref={back}
          type="button"
          aria-label="Back to player"
          className="btn btn-ghost btn-circle"
          onClick={requestBack}
        >
          <ArrowLeft className="size-5" />
        </button>
        <h2 id={titleId} className="flex-1 font-display text-xl font-semibold">
          Bookmarks
        </h2>
        <AddBookmark onClick={() => dispatch({ type: "bookmark" })} />
      </header>
      <div className="flex-1 overflow-y-auto px-safe py-4">
        <BookmarkList state={draft} dispatch={dispatch} />
      </div>
      <footer className="border-t-2 border-pop bg-base-100 pt-3 px-safe pb-safe">
        <button type="button" className="btn btn-primary btn-pop btn-block" onClick={save}>
          <Save className="size-4" />
          {labelForAction("player", "player-save-bookmarks", "Save")}
        </button>
      </footer>
      <dialog ref={confirm} aria-labelledby={confirmId} className="modal modal-bottom sm:modal-middle">
        <div className="modal-box border-2 border-pop pb-safe shadow-pop">
          <h3 id={confirmId} className="text-xl font-semibold">
            Discard changes?
          </h3>
          <p className="py-3 opacity-80">Unsaved notes and tags will be lost.</p>
          <div className="modal-action">
            <form method="dialog">
              <button type="submit" className="btn btn-ghost">
                Keep editing
              </button>
            </form>
            <button
              type="button"
              className="btn btn-error btn-pop"
              onClick={() => {
                confirm.current?.close();
                leave();
              }}
            >
              Discard
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" aria-label="Close">
            close
          </button>
        </form>
      </dialog>
    </div>
  );
}

/** Use this screen to operate the audiobook control panel against the demo title. */
export function Player() {
  const [s, dispatch] = useReducer(playerReducer, undefined, load);
  const { book } = s;
  const ci = chapterAt(book, s.position);
  const chapter = book.chapters[ci]!;
  const end = chapterEnd(book, ci);
  const phone = useIsPhone();
  // Once open, the sheet stays until saved or discarded, even if the window widens.
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!s.playing) return;
    const id = setInterval(() => dispatch({ type: "tick", seconds: TICK_MS / 1000 }), TICK_MS);
    return () => clearInterval(id);
  }, [s.playing]);

  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ position: s.position, rate: s.rate, bookmarks: s.bookmarks, tagLibrary: s.tagLibrary }),
      );
    } catch {
      /* storage blocked: state lasts for this visit only */
    }
  }, [s.position, s.rate, s.bookmarks, s.tagLibrary]);

  const toggleLabel = s.playing ? "Pause" : "Play";
  return (
    <Screen id="player">
      {/* Side by side when the content area is ≥48rem (sidebar-aware); stacked otherwise. */}
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
          {/* Side by side, both panels are twice the player's natural height (~16.5rem); controls spread to fill. */}
          <Panel className="@3xl:flex @3xl:min-h-[33rem] @3xl:flex-col @3xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid size-16 shrink-0 place-items-center rounded-box border-2 border-pop bg-primary text-primary-content shadow-pop-sm">
                <Headphones className="size-8" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-semibold">{book.title}</p>
                <p className="text-sm opacity-70">{book.author}</p>
                <p className="truncate font-semibold" aria-live="polite">
                  {chapter.title}
                </p>
              </div>
              <div className="ms-auto flex flex-col items-end gap-2 self-start">
                <span className="badge badge-accent badge-sm font-semibold">demo</span>
                {phone && (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`${labelForAction("player", "player-open-bookmarks", "Bookmarks")} (${s.bookmarks.length})`}
                    className="btn btn-pop btn-circle btn-secondary indicator"
                    onClick={() => setSheetOpen(true)}
                  >
                    <BookmarkIcon className="size-5" />
                    {s.bookmarks.length > 0 && (
                      <span className="indicator-item badge badge-primary badge-xs tabular-nums">
                        {s.bookmarks.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-1">
              <input
                type="range"
                aria-label="Position"
                className="range range-primary range-sm w-full"
                min={0}
                max={book.duration}
                step={1}
                value={Math.floor(s.position)}
                onChange={(e) => dispatch({ type: "seek", position: Number(e.target.value) })}
              />
              <div className="flex justify-between text-sm tabular-nums opacity-80">
                <span>{formatTime(s.position)}</span>
                <span>
                  Chapter {formatTime(s.position - chapter.start)} / {formatTime(end - chapter.start)}
                </span>
                <span>−{formatTime(book.duration - s.position)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <Control
                action="chapterStart"
                spec="player-chapter-start"
                fallback="Beginning of chapter"
                icon={SkipBack}
                dispatch={dispatch}
              />
              <Control
                action="rewind"
                spec="player-rewind"
                fallback="Rewind 30 seconds"
                icon={Rewind}
                disabled={s.position <= 0}
                dispatch={dispatch}
              />
              <button
                type="button"
                aria-label={toggleLabel}
                title={toggleLabel}
                className="btn btn-pop btn-circle btn-primary btn-lg size-16"
                onClick={() => dispatch({ type: "toggle" })}
              >
                {s.playing ? <Pause className="size-7" /> : <Play className="size-7" />}
              </button>
              <Control
                action="forward"
                spec="player-forward"
                fallback="Fast forward 30 seconds"
                icon={FastForward}
                disabled={s.position >= book.duration}
                dispatch={dispatch}
              />
              <Control
                action="chapterEnd"
                spec="player-chapter-end"
                fallback="End of chapter"
                icon={SkipForward}
                disabled={s.position >= book.duration}
                dispatch={dispatch}
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Control
                action="slower"
                spec="player-slower"
                fallback="Slower (−5%)"
                icon={Minus}
                disabled={s.rate <= MIN_RATE}
                dispatch={dispatch}
              />
              <output
                aria-label="Playback speed"
                className="min-w-20 text-center font-display text-xl font-semibold tabular-nums"
              >
                {formatRate(s.rate)}
              </output>
              <Control
                action="faster"
                spec="player-faster"
                fallback="Faster (+5%)"
                icon={Plus}
                disabled={s.rate >= MAX_RATE}
                dispatch={dispatch}
              />
            </div>
          </Panel>

          {!phone && (
            <Panel
              className="@3xl:min-h-[33rem]"
              title={
                <span className="flex items-center justify-between gap-3">
                  Bookmarks
                  <AddBookmark onClick={() => dispatch({ type: "bookmark" })} />
                </span>
              }
            >
              <BookmarkList state={s} dispatch={dispatch} />
            </Panel>
          )}
        </div>
      </div>
      {sheetOpen && <BookmarkSheet live={s} liveDispatch={dispatch} onClose={() => setSheetOpen(false)} />}
    </Screen>
  );
}
