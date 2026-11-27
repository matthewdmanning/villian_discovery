import { describe, expect, it } from "vitest";
import { hasValue, summarizeBooks } from "../ui/src/lib/sync-books.ts";
import { displaySyncValue, isAppConflict } from "../ui/src/lib/sync-format.ts";
import { summarizeSyncResult } from "../ui/src/lib/sync-state.ts";

const row = (bookId, field, value, extra = {}) => ({ bookId, title: bookId, field, value, source: "libby", ...extra });

describe("sync display failure modes", () => {
  it("does not present conflicting progress or rating as settled values", () => {
    const [book] = summarizeBooks([
      row("Book", "checkedOut", true),
      row("Book", "readingProgress", 65, { conflict: "Different progress" }),
      row("Book", "rating", 5, { conflict: "Different ratings" }),
    ]);
    expect(book.checkedOut).toBe(true);
    expect(book.progress).toBeUndefined();
    expect(book.rating).toBeUndefined();
    expect(book.rows.filter((field) => field.conflict)).toHaveLength(2);
  });

  it("distinguishes zero and false from missing or cleared fields", () => {
    for (const value of [0, false]) expect(hasValue(value)).toBe(true);
    for (const value of [undefined, null, "", []]) expect(hasValue(value)).toBe(false);
    expect(displaySyncValue(0, "readingProgress")).toBe("0%");
    expect(displaySyncValue(false, "finished")).toBe("No");
    expect(isAppConflict({ before: { value: false } })).toBe(true);
    expect(isAppConflict({ before: { value: [] } })).toBe(false);
  });

  it("does not report a partial apply as a success", () => {
    const summary = summarizeSyncResult(
      { operations: [] },
      {
        outcomes: [{ status: "success" }, { status: "failed" }, { status: "unknown" }],
      },
    );
    expect(summary.status).toBe("Fail");
    expect(summary.summary).toContain("Applied 1 change");
    expect(summary.summary).toContain("2 changes could not be confirmed");
  });
});
