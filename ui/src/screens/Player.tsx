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
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useReducer } from "react";
import { Empty, Panel, Screen, sz } from "../components/ui.tsx";
import {
  chapterAt,
  chapterEnd,
  clampRate,
  createPlayer,
  DEMO_AUDIOBOOK,
  formatRate,
  formatTime,
  MAX_RATE,
  MIN_RATE,
  type PlayerAction,
  type PlayerState,
  playerReducer,
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
    const bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks : [];
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

/** Use this screen to operate the audiobook control panel against the demo title. */
export function Player() {
  const [s, dispatch] = useReducer(playerReducer, undefined, load);
  const { book } = s;
  const ci = chapterAt(book, s.position);
  const chapter = book.chapters[ci]!;
  const end = chapterEnd(book, ci);

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
          <ul className="divide-y-2 divide-base-200">
            {s.bookmarks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-start hover:bg-base-200"
                  onClick={() => dispatch({ type: "seek", position: b.position })}
                >
                  <span className="truncate">{book.chapters[b.chapter]?.title}</span>
                  <span className="tabular-nums opacity-80">{formatTime(b.position)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Screen>
  );
}
