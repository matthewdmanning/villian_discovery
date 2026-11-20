import { describe, expect, it } from "vitest";
import {
  chapterAt,
  createPlayer,
  findTag,
  formatRate,
  formatTime,
  hasTag,
  MAX_NOTE_LENGTH,
  MAX_RATE,
  MAX_TAG_LENGTH,
  MIN_RATE,
  mergeTags,
  normalizeTag,
  playerReducer,
  restoreBookmarks,
  restoreTagLibrary,
  SKIP_SECONDS,
  sameBookmarkData,
} from "../ui/src/lib/player.ts";

const book = {
  title: "T",
  author: "A",
  duration: 1000,
  chapters: [
    { title: "One", start: 0 },
    { title: "Two", start: 300 },
    { title: "Three", start: 700 },
  ],
};
const run = (state, ...types) => types.reduce((s, type) => playerReducer(s, { type }), state);
const at = (position, extra = {}) => ({ ...createPlayer(book), position, ...extra });

describe("audiobook player", () => {
  it("toggles play and advances only while playing, scaled by speed", () => {
    const paused = playerReducer(at(10), { type: "tick", seconds: 5 });
    expect(paused.position).toBe(10);
    const playing = run(at(10, { rate: 1.5 }), "toggle");
    expect(playing.playing).toBe(true);
    expect(playerReducer(playing, { type: "tick", seconds: 2 }).position).toBe(13);
    expect(run(playing, "toggle").playing).toBe(false);
  });

  it("stops at the end and restarts on play", () => {
    const ended = playerReducer(at(999, { playing: true }), { type: "tick", seconds: 5 });
    expect(ended).toMatchObject({ position: 1000, playing: false });
    expect(run(ended, "toggle")).toMatchObject({ position: 0, playing: true });
  });

  it("rewinds and fast-forwards by the skip step within the book", () => {
    expect(run(at(100), "rewind").position).toBe(100 - SKIP_SECONDS);
    expect(run(at(100), "forward").position).toBe(100 + SKIP_SECONDS);
    expect(run(at(5), "rewind").position).toBe(0);
    expect(run(at(990), "forward").position).toBe(1000);
  });

  it("changes speed by 5% steps without drift and within bounds", () => {
    expect(run(at(0), "faster", "faster", "faster").rate).toBe(1.15);
    expect(run(at(0), "slower").rate).toBe(0.95);
    expect(run(at(0, { rate: MAX_RATE }), "faster").rate).toBe(MAX_RATE);
    expect(run(at(0, { rate: MIN_RATE }), "slower").rate).toBe(MIN_RATE);
    expect(formatRate(1.05)).toBe("1.05×");
  });

  it("adds sorted, de-duplicated bookmarks with their chapter", () => {
    let s = playerReducer(at(450.7), { type: "bookmark", now: "t1" });
    s = playerReducer({ ...s, position: 20 }, { type: "bookmark", now: "t2" });
    s = playerReducer({ ...s, position: 450.2 }, { type: "bookmark", now: "t3" });
    expect(s.bookmarks).toEqual([
      { id: 2, position: 20, chapter: 0, createdAt: "t2", note: "", tags: [] },
      { id: 1, position: 450, chapter: 1, createdAt: "t1", note: "", tags: [] },
    ]);
  });

  it("skips to chapter start, or the previous chapter near the start", () => {
    expect(run(at(450), "chapterStart").position).toBe(300);
    expect(run(at(301), "chapterStart").position).toBe(0);
    expect(run(at(1), "chapterStart").position).toBe(0);
  });

  it("skips to chapter end, which is the next chapter's start or the book's end", () => {
    expect(run(at(450), "chapterEnd").position).toBe(700);
    expect(chapterAt(book, 700)).toBe(2);
    expect(run(at(800, { playing: true }), "chapterEnd")).toMatchObject({ position: 1000, playing: false });
  });

  it("formats times", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3725)).toBe("1:02:05");
  });
});

describe("bookmark notes and tags", () => {
  const marked = () => playerReducer(at(450), { type: "bookmark", now: "t" });
  const act = (s, a) => playerReducer(s, { id: 1, ...a });

  it("starts with an empty note and no tags", () => {
    expect(marked().bookmarks[0]).toMatchObject({ note: "", tags: [] });
  });

  it("sets notes, capped, and keeps state identity when unchanged", () => {
    const s = act(marked(), { type: "bookmarkNote", note: "Great line" });
    expect(s.bookmarks[0].note).toBe("Great line");
    expect(act(s, { type: "bookmarkNote", note: "Great line" })).toBe(s);
    expect(act(s, { type: "bookmarkNote", note: "x".repeat(MAX_NOTE_LENGTH + 5) }).bookmarks[0].note).toHaveLength(
      MAX_NOTE_LENGTH,
    );
  });

  it("applies only library tags; bookmarkTag never creates one", () => {
    const s = marked();
    expect(act(s, { type: "bookmarkTag", tag: "quote" })).toBe(s);
    expect(s.tagLibrary).toEqual([]);
  });

  it("creates tags only through createTag, applying them to the bookmark", () => {
    let s = act(marked(), { type: "createTag", name: "  plot   twist " });
    s = act(s, { type: "createTag", name: "Plot Twist" });
    s = playerReducer(s, { type: "createTag", name: "quote" });
    expect(s.tagLibrary).toEqual(["plot twist", "quote"]);
    expect(s.bookmarks[0].tags).toEqual(["plot twist"]);
    expect(act(s, { type: "createTag", name: "   " })).toBe(s);
    expect(act(s, { type: "createTag", name: "x".repeat(MAX_TAG_LENGTH + 1) })).toBe(s);
  });

  it("toggles library tags on a bookmark ignoring case", () => {
    let s = playerReducer(marked(), { type: "createTag", name: "Music" });
    s = act(s, { type: "bookmarkTag", tag: "music" });
    expect(s.bookmarks[0].tags).toEqual(["Music"]);
    expect(act(s, { type: "bookmarkTag", tag: "MUSIC" })).toBe(s);
    expect(hasTag(s.bookmarks[0], "MUSIC")).toBe(true);
    s = act(s, { type: "bookmarkUntag", tag: "MUSIC" });
    expect(s.bookmarks[0].tags).toEqual([]);
    expect(s.tagLibrary).toEqual(["Music"]);
    expect(act(s, { type: "bookmarkUntag", tag: "missing" })).toBe(s);
  });

  it("reuses an existing tag's spelling when New Tag repeats it", () => {
    let s = act(marked(), { type: "createTag", name: "Music" });
    s = playerReducer({ ...s, position: 20 }, { type: "bookmark", now: "t" });
    s = playerReducer(s, { type: "createTag", id: 2, name: "music" });
    expect(s.tagLibrary).toEqual(["Music"]);
    expect(s.bookmarks.map((b) => b.tags)).toEqual([["Music"], ["Music"]]);
  });

  it("ignores edits to unknown bookmarks", () => {
    const s = playerReducer(marked(), { type: "createTag", name: "x" });
    expect(playerReducer(s, { type: "bookmarkTag", id: 99, tag: "x" })).toBe(s);
  });

  it("merges tag lists into a sorted library", () => {
    expect(mergeTags(["quote", "Zed"], ["Quote", "alpha", 5, " "])).toEqual(["alpha", "quote", "Zed"]);
    expect(findTag(["Music"], "MUSIC")).toBe("Music");
    expect(normalizeTag(" a  b ")).toBe("a b");
  });

  it("restores the tag library, including tags found on bookmarks", () => {
    const marks = restoreBookmarks(book, [{ id: 1, position: 5, tags: ["Kept"] }]);
    expect(restoreTagLibrary(["saved", "KEPT"], marks)).toEqual(["Kept", "saved"]);
    expect(restoreTagLibrary("junk", [])).toEqual([]);
  });

  it("restores saved bookmarks, filling fields that older saves lack", () => {
    const restored = restoreBookmarks(book, [
      { id: 2, position: 800.9, chapter: 0, createdAt: "t" },
      { id: 1, position: 20, note: "n", tags: ["a", "A", " ", 5] },
      { id: 1, position: 30 },
      { position: 40 },
      null,
    ]);
    expect(restored).toEqual([
      { id: 1, position: 20, chapter: 0, createdAt: "", note: "n", tags: ["a"] },
      { id: 2, position: 800, chapter: 2, createdAt: "t", note: "", tags: [] },
    ]);
    expect(restoreBookmarks(book, "junk")).toEqual([]);
  });
});

describe("bookmark drafts (phone sheet)", () => {
  const base = () => {
    const s = playerReducer(at(450), { type: "bookmark", now: "t" });
    return playerReducer(s, { type: "createTag", id: 1, name: "Music" });
  };

  it("compares bookmark data by value", () => {
    const s = base();
    expect(sameBookmarkData(s, s)).toBe(true);
    const edited = playerReducer(s, { type: "bookmarkNote", id: 1, note: "x" });
    expect(sameBookmarkData(s, edited)).toBe(false);
    const reverted = playerReducer(edited, { type: "bookmarkNote", id: 1, note: "" });
    expect(sameBookmarkData(s, reverted)).toBe(true);
  });

  it("commits a draft with setBookmarks, keeping playback state", () => {
    const live = { ...base(), playing: true, rate: 1.5 };
    const draft = playerReducer(live, { type: "bookmarkNote", id: 1, note: "saved" });
    const next = playerReducer(live, {
      type: "setBookmarks",
      bookmarks: draft.bookmarks,
      tagLibrary: draft.tagLibrary,
    });
    expect(next.bookmarks[0].note).toBe("saved");
    expect(next.tagLibrary).toEqual(["Music"]);
    expect(next).toMatchObject({ playing: true, rate: 1.5, position: 450 });
  });

  it("re-validates committed drafts", () => {
    const next = playerReducer(base(), {
      type: "setBookmarks",
      bookmarks: [{ id: 1, position: 5, tags: ["New"] }, { position: 9 }],
      tagLibrary: [],
    });
    expect(next.bookmarks).toEqual([{ id: 1, position: 5, chapter: 0, createdAt: "", note: "", tags: ["New"] }]);
    expect(next.tagLibrary).toEqual(["New"]);
  });
});
