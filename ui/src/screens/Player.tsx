import {
  BookmarkPlus,
  FastForward,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  SkipBack,
  SkipForward,
  Tag,
  X,
} from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { useEffect, useId, useReducer, useState } from "react";
import { Empty, Panel, Screen, sz } from "../components/ui.tsx";
import {
  allTags,
  type Bookmark,
  chapterAt,
  chapterEnd,
  clampRate,
  createPlayer,
  DEMO_AUDIOBOOK,
  formatRate,
  formatTime,
  hasTag,
  MAX_NOTE_LENGTH,
  MAX_RATE,
  MAX_TAG_LENGTH,
  MIN_RATE,
  type PlayerAction,
  type PlayerState,
  playerReducer,
  restoreBookmarks,
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
    const state = { ...fresh, bookmarks, rate: clampRate(saved.rate) };
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

/** One bookmark: jump to it, write a note, add or remove tags. Enter or comma adds the typed tag. */
function BookmarkItem(props: {
  mark: Bookmark;
  chapter: string;
  suggestions: string;
  dispatch(a: PlayerAction): void;
}) {
  const { mark, dispatch } = props;
  const [draft, setDraft] = useState("");
  const noteId = useId();
  const addTag = () => {
    for (const tag of draft.split(",")) dispatch({ type: "bookmarkTag", id: mark.id, tag });
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !draft && mark.tags.length) {
      dispatch({ type: "bookmarkUntag", id: mark.id, tag: mark.tags.at(-1)! });
    }
  };
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
          <span key={t} className="badge badge-secondary gap-1 font-semibold">
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
        <label className={`input min-w-40 flex-1 ${sz("input")}`}>
          <Tag className="size-4 opacity-60" />
          <input
            type="text"
            aria-label={`Add tag to bookmark at ${formatTime(mark.position)}`}
            placeholder="Add tag"
            list={props.suggestions}
            maxLength={MAX_TAG_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={addTag}
          />
        </label>
      </div>
    </li>
  );
}

/** Use this screen to operate the audiobook control panel against the demo title. */
export function Player() {
  const [s, dispatch] = useReducer(playerReducer, undefined, load);
  const { book } = s;
  const ci = chapterAt(book, s.position);
  const chapter = book.chapters[ci]!;
  const end = chapterEnd(book, ci);
  const tags = allTags(s.bookmarks);
  const [picked, setFilter] = useState<string>();
  // A filter whose tag no longer exists shows everything.
  const filter = picked !== undefined && tags.includes(picked) ? picked : undefined;
  const shown = filter ? s.bookmarks.filter((b) => hasTag(b, filter)) : s.bookmarks;
  const suggestions = useId();

  useEffect(() => {
    if (!s.playing) return;
    const id = setInterval(() => dispatch({ type: "tick", seconds: TICK_MS / 1000 }), TICK_MS);
    return () => clearInterval(id);
  }, [s.playing]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ position: s.position, rate: s.rate, bookmarks: s.bookmarks }));
    } catch {
      /* storage blocked: state lasts for this visit only */
    }
  }, [s.position, s.rate, s.bookmarks]);

  const toggleLabel = s.playing ? "Pause" : "Play";
  return (
    <Screen id="player">
      <Panel>
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
          <span className="badge badge-accent badge-sm ms-auto self-start font-semibold">demo</span>
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

      <Panel
        title={
          <span className="flex items-center justify-between gap-3">
            Bookmarks
            <button
              type="button"
              className={`btn btn-pop btn-secondary ${sz("btn")}`}
              onClick={() => dispatch({ type: "bookmark" })}
            >
              <BookmarkPlus className="size-4" />
              {labelForAction("player", "player-bookmark", "Add bookmark")}
            </button>
          </span>
        }
      >
        {s.bookmarks.length === 0 ? (
          <Empty icon={<BookmarkPlus className="size-6" />} title="No bookmarks yet" />
        ) : (
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
            <datalist id={suggestions}>
              {tags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <ul className="divide-y-2 divide-base-200">
              {shown.map((b) => (
                <BookmarkItem
                  key={b.id}
                  mark={b}
                  chapter={book.chapters[b.chapter]?.title ?? ""}
                  suggestions={suggestions}
                  dispatch={dispatch}
                />
              ))}
            </ul>
          </>
        )}
      </Panel>
    </Screen>
  );
}
