/** Audiobook control panel state. Pure: no timers, no audio; the screen drives `tick`. Times in seconds. */

export interface Chapter {
  title: string;
  /** Chapter start, seconds from book start. Chapters are contiguous; a chapter ends where the next starts. */
  start: number;
}
export interface Bookmark {
  id: number;
  position: number;
  chapter: number;
  createdAt: string;
  note: string;
  /** Custom labels; unique ignoring case, in the order added. */
  tags: string[];
}
export interface Audiobook {
  title: string;
  author: string;
  duration: number;
  chapters: Chapter[];
}
export interface PlayerState {
  book: Audiobook;
  position: number;
  playing: boolean;
  rate: number;
  bookmarks: Bookmark[];
}

/** Rewind / fast-forward jump. */
export const SKIP_SECONDS = 30;
/** Speed step: 5 percentage points of normal speed (1.00× → 1.05×). */
export const RATE_STEP = 0.05;
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
/** "Beginning of chapter" within this many seconds of the start goes to the previous chapter instead. */
export const RESTART_GRACE = 3;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAG_LENGTH = 32;

/** Trims and collapses inner whitespace; empty or over-long input returns undefined. */
export function normalizeTag(tag: string): string | undefined {
  const t = tag.trim().replace(/\s+/g, " ");
  return t && t.length <= MAX_TAG_LENGTH ? t : undefined;
}
const sameTag = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

export const hasTag = (b: Bookmark, tag: string) => b.tags.some((t) => sameTag(t, tag));

/** Every tag used on any bookmark, first spelling wins, sorted for suggestions. */
export function allTags(bookmarks: readonly Bookmark[]): string[] {
  const out: string[] = [];
  for (const b of bookmarks) for (const t of b.tags) if (!out.some((o) => sameTag(o, t))) out.push(t);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Rebuilds bookmarks from untrusted saved data; drops invalid entries and fills fields added later. */
export function restoreBookmarks(book: Audiobook, saved: unknown): Bookmark[] {
  if (!Array.isArray(saved)) return [];
  const out: Bookmark[] = [];
  for (const raw of saved as Partial<Bookmark>[]) {
    if (!raw || typeof raw.id !== "number" || typeof raw.position !== "number") continue;
    if (out.some((b) => b.id === raw.id || b.position === raw.position)) continue;
    const position = clamp(Math.floor(raw.position), 0, book.duration);
    const tags: string[] = [];
    for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
      const n = typeof t === "string" ? normalizeTag(t) : undefined;
      if (n && !tags.some((x) => sameTag(x, n))) tags.push(n);
    }
    out.push({
      id: raw.id,
      position,
      chapter: chapterAt(book, position),
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
      note: typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE_LENGTH) : "",
      tags,
    });
  }
  return out.sort((x, y) => x.position - y.position);
}

export type PlayerAction =
  | { type: "toggle" }
  | { type: "tick"; seconds: number }
  | { type: "rewind" }
  | { type: "forward" }
  | { type: "slower" }
  | { type: "faster" }
  | { type: "bookmark"; now?: string }
  | { type: "bookmarkNote"; id: number; note: string }
  | { type: "bookmarkTag"; id: number; tag: string }
  | { type: "bookmarkUntag"; id: number; tag: string }
  | { type: "chapterStart" }
  | { type: "chapterEnd" }
  | { type: "seek"; position: number };

export function createPlayer(book: Audiobook): PlayerState {
  return { book, position: 0, playing: false, rate: 1, bookmarks: [] };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Rounds to hundredths so repeated 0.05 steps never drift (1.1500000002). */
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Bounds and rounds a speed; non-numbers become normal speed. */
export const clampRate = (rate: unknown) =>
  typeof rate === "number" && Number.isFinite(rate) ? round2(clamp(rate, MIN_RATE, MAX_RATE)) : 1;

/** Index of the chapter containing `position`; the book's end belongs to the last chapter. */
export function chapterAt(book: Audiobook, position: number): number {
  let i = 0;
  for (let c = 0; c < book.chapters.length; c++) if (book.chapters[c]!.start <= position) i = c;
  return i;
}
export function chapterEnd(book: Audiobook, index: number): number {
  return book.chapters[index + 1]?.start ?? book.duration;
}

function seek(s: PlayerState, position: number): PlayerState {
  const p = clamp(position, 0, s.book.duration);
  // Reaching the end stops playback, like a real player.
  return { ...s, position: p, playing: s.playing && p < s.book.duration };
}

/** Applies `edit` to bookmark `id`. `edit` returns `b` itself when nothing changes, so `s` is kept and React skips renders. */
function editBookmark(s: PlayerState, id: number, edit: (b: Bookmark) => Bookmark): PlayerState {
  let changed = false;
  const bookmarks = s.bookmarks.map((b) => {
    if (b.id !== id) return b;
    const next = edit(b);
    if (next !== b) changed = true;
    return next;
  });
  return changed ? { ...s, bookmarks } : s;
}

export function playerReducer(s: PlayerState, a: PlayerAction): PlayerState {
  switch (a.type) {
    case "toggle":
      // Play at the end restarts the book.
      if (!s.playing && s.position >= s.book.duration) return { ...s, position: 0, playing: true };
      return { ...s, playing: !s.playing };
    case "tick":
      return s.playing ? seek(s, s.position + a.seconds * s.rate) : s;
    case "rewind":
      return seek(s, s.position - SKIP_SECONDS);
    case "forward":
      return seek(s, s.position + SKIP_SECONDS);
    case "slower":
      return { ...s, rate: clampRate(s.rate - RATE_STEP) };
    case "faster":
      return { ...s, rate: clampRate(s.rate + RATE_STEP) };
    case "bookmark": {
      const position = Math.floor(s.position);
      if (s.bookmarks.some((b) => b.position === position)) return s;
      const id = s.bookmarks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
      const mark: Bookmark = {
        id,
        position,
        chapter: chapterAt(s.book, position),
        createdAt: a.now ?? new Date().toISOString(),
        note: "",
        tags: [],
      };
      return { ...s, bookmarks: [...s.bookmarks, mark].sort((x, y) => x.position - y.position) };
    }
    case "bookmarkNote": {
      const note = a.note.slice(0, MAX_NOTE_LENGTH);
      return editBookmark(s, a.id, (b) => (b.note === note ? b : { ...b, note }));
    }
    case "bookmarkTag": {
      const typed = normalizeTag(a.tag);
      if (!typed) return s;
      // Reuse the spelling already used on another bookmark, so "music" joins "Music".
      const tag = allTags(s.bookmarks).find((t) => sameTag(t, typed)) ?? typed;
      return editBookmark(s, a.id, (b) => (b.tags.some((t) => sameTag(t, tag)) ? b : { ...b, tags: [...b.tags, tag] }));
    }
    case "bookmarkUntag":
      return editBookmark(s, a.id, (b) => {
        const tags = b.tags.filter((t) => !sameTag(t, a.tag));
        return tags.length === b.tags.length ? b : { ...b, tags };
      });
    case "chapterStart": {
      const i = chapterAt(s.book, s.position);
      const start = s.book.chapters[i]?.start ?? 0;
      const prev = s.position - start < RESTART_GRACE && i > 0 ? i - 1 : i;
      return seek(s, s.book.chapters[prev]?.start ?? 0);
    }
    case "chapterEnd":
      return seek(s, chapterEnd(s.book, chapterAt(s.book, s.position)));
    case "seek":
      return seek(s, a.position);
  }
}

/** `h:mm:ss` or `m:ss`. */
export function formatTime(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export const formatRate = (rate: number) => `${rate.toFixed(2)}×`;

/** Demo title for the browser-only panel. No Libby audio is streamed. */
export const DEMO_AUDIOBOOK: Audiobook = {
  title: "The Lighthouse Ledger",
  author: "Demo Narration",
  duration: 4 * 3600 + 12 * 60,
  chapters: [
    { title: "Opening Credits", start: 0 },
    { title: "Chapter 1: The Keeper", start: 45 },
    { title: "Chapter 2: Fog Season", start: 38 * 60 },
    { title: "Chapter 3: The Ledger", start: 81 * 60 },
    { title: "Chapter 4: Low Tide", start: 2 * 3600 + 5 * 60 },
    { title: "Chapter 5: Signal Fires", start: 2 * 3600 + 58 * 60 },
    { title: "End Credits", start: 4 * 3600 + 10 * 60 },
  ],
};
