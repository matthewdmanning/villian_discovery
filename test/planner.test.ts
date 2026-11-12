import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import type { Candidate, RunState } from "../src/planner.js";
import { lendingDays, planBook } from "../src/planner.js";
import { card, media } from "./fixtures.js";

const base = parseConfig({});
const cfg = (over: Parameters<typeof parseConfig>[0] = {}) => parseConfig(over);
const state = (over: Partial<RunState> = {}): RunState => ({
  counts: new Map(),
  loanTitleIds: new Set(),
  holdTitleIds: new Set(),
  borrowsThisRun: 0,
  holdsThisRun: 0,
  ...over,
});
const cand = (c = card(), m = media()): Candidate => ({ card: c, match: { media: m, titleScore: 1, authorScore: 1, isbnMatch: false } });
const book = { raw: "x", title: "Project Hail Mary" };

describe("planBook", () => {
  it("auto borrows the first available library", () => {
    const p = planBook(book, [cand(card({ advantageKey: "a" })), cand(card({ cardId: "2", advantageKey: "b" }), media({ isAvailable: true }))], state(), base);
    expect(p).toMatchObject({ kind: "borrow", card: { advantageKey: "b" }, days: 14, luckyDay: false });
  });

  it("auto borrows lucky day copies only when allowed", () => {
    const lucky = [cand(card(), media({ luckyDayAvailableCopies: 1 }))];
    expect(planBook(book, lucky, state(), base)).toMatchObject({ kind: "borrow", luckyDay: true });
    expect(planBook(book, lucky, state(), cfg({ borrow: { luckyDay: false } })).kind).toBe("hold");
  });

  it("auto falls back to hold at shortest wait (placement=best)", () => {
    const p = planBook(
      book,
      [cand(card({ advantageKey: "a" }), media({ estimatedWaitDays: 60 })), cand(card({ cardId: "2", advantageKey: "b" }), media({ estimatedWaitDays: 10 }))],
      state(),
      base,
    );
    expect(p).toMatchObject({ kind: "hold", targets: [{ card: { advantageKey: "b" } }] });
  });

  it("placement=first and placement=all", () => {
    const cs = [cand(card({ advantageKey: "a" }), media({ estimatedWaitDays: 60 })), cand(card({ cardId: "2", advantageKey: "b" }), media({ estimatedWaitDays: 10 }))];
    const first = planBook(book, cs, state(), cfg({ hold: { placement: "first" } }));
    expect(first.kind === "hold" && first.targets.map((t) => t.card.advantageKey)).toEqual(["a"]);
    const all = planBook(book, cs, state(), cfg({ hold: { placement: "all" } }));
    expect(all.kind === "hold" && all.targets.map((t) => t.card.advantageKey)).toEqual(["a", "b"]);
    const capped = planBook(book, cs, state({ holdsThisRun: 1 }), cfg({ hold: { placement: "all", maxPerRun: 2 } }));
    expect(capped.kind === "hold" && capped.targets.length).toBe(1);
  });

  it("borrow-only skips unavailable titles", () => {
    expect(planBook(book, [cand()], state(), cfg({ action: "borrow" }))).toMatchObject({ kind: "skip", reason: "no copies available" });
  });

  it("per-book action overrides config", () => {
    const avail = [cand(card(), media({ isAvailable: true }))];
    expect(planBook({ ...book, action: "hold" }, avail, state(), base).kind).toBe("hold");
  });

  it("respects card limits using run state counts", () => {
    const avail = [cand(card({ limits: { loan: 2, hold: 1 } }), media({ isAvailable: true }))];
    const full = state({ counts: new Map([["100", { loan: 2, hold: 1 }]]) });
    expect(planBook(book, avail, full, base)).toMatchObject({ kind: "skip", reason: expect.stringMatching(/loan limit.*hold limit/) });
    expect(planBook(book, avail, full, cfg({ respectCardLimits: false })).kind).toBe("borrow");
  });

  it("honours borrow maxPerRun by holding instead", () => {
    const avail = [cand(card(), media({ isAvailable: true }))];
    expect(planBook(book, avail, state({ borrowsThisRun: 1 }), cfg({ borrow: { maxPerRun: 1 } })).kind).toBe("hold");
  });

  it("skips long waits and long queues", () => {
    expect(planBook(book, [cand()], state(), cfg({ hold: { maxEstimatedWaitDays: 7 } }))).toMatchObject({ kind: "skip", reason: expect.stringContaining("~30 days") });
    expect(planBook(book, [cand()], state(), cfg({ hold: { maxHoldsCount: 5 } })).kind).toBe("skip");
  });

  it("skips existing loans and holds unless disabled", () => {
    expect(planBook(book, [cand()], state({ loanTitleIds: new Set(["111"]) }), base)).toMatchObject({ kind: "skip", reason: "already on loan" });
    expect(planBook(book, [cand()], state({ holdTitleIds: new Set(["111"]) }), base)).toMatchObject({ kind: "skip", reason: "already on hold" });
    expect(planBook(book, [cand()], state({ holdTitleIds: new Set(["111"]) }), cfg({ skipExisting: false })).kind).toBe("hold");
  });

  it("skips titles nobody owns", () => {
    expect(planBook(book, [cand(card(), media({ isOwned: false, ownedCopies: 0 }))], state(), base).kind).toBe("skip");
    expect(planBook(book, [], state(), base)).toMatchObject({ kind: "skip", reason: "not found in any library" });
  });
});

describe("lendingDays", () => {
  const c = card();
  it.each([
    ["preference", 14],
    ["max", 21],
    [10, 7],
    [3, 7],
    [21, 21],
  ] as const)("%s -> %d", (pref, days) => expect(lendingDays(c, "ebook", pref)).toBe(days));
  it("falls back when card has no periods", () => expect(lendingDays(card({ lendingPeriods: {} }), "audiobook", "preference")).toBe(21));
});
