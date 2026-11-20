import { describe, expect, it } from "vitest";
import {
  chapterAt,
  createPlayer,
  formatRate,
  formatTime,
  MAX_RATE,
  MIN_RATE,
  playerReducer,
  SKIP_SECONDS,
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
      { id: 2, position: 20, chapter: 0, createdAt: "t2" },
      { id: 1, position: 450, chapter: 1, createdAt: "t1" },
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
