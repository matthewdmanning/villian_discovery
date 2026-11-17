import { describe, expect, it } from "vitest";
import { reconcileSnapshots, reconcileSnapshotsDetailed } from "../src/sync.js";
import { SYNC_FALLBACKS } from "../src/sync-config.js";

describe("reconcileSnapshots", () => {
  it("rejects an explicitly invalid settings object rather than silently falling back", () => {
    expect(() => reconcileSnapshotsDetailed([], [], null)).toThrow();
  });
  it("does not treat colliding provider-local book IDs as a shared identity", () => {
    const result = reconcileSnapshotsDetailed(
      [{ bookId: "123", title: "First", fields: { notes: { value: "private" } } }],
      [{ bookId: "123", title: "Unrelated", fields: { notes: { value: "other" } } }],
      SYNC_FALLBACKS,
    );
    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((group) => !group.libby.length || !group.fable.length)).toBe(true);
  });
  it("does not auto-match different author initials through the search normalizer", () => {
    const result = reconcileSnapshotsDetailed(
      [{ bookId: "libby", title: "Collected Poems", author: "A. B. Smith", fields: { notes: { value: "private" } } }],
      [{ bookId: "fable", title: "Collected Poems", author: "C. D. Smith", fields: { notes: { value: "other" } } }],
      SYNC_FALLBACKS,
    );
    expect(result.groups.every((group) => !group.libby.length || !group.fable.length)).toBe(true);
  });
  it("preserves explicit clearing and metadata present in only one source", () => {
    const rows = reconcileSnapshots(
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: { notes: { value: null, updatedAt: "2026-01-03T00:00:00Z" }, rating: { value: 4 } },
        },
      ],
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            notes: { value: "Old note", updatedAt: "2026-01-02T00:00:00Z" },
            shelves: { value: ["Favorites"] },
          },
        },
      ],
    );
    expect(rows.find((row) => row.field === "notes")).toMatchObject({ value: null, source: "libby" });
    expect(rows.find((row) => row.field === "rating")).toMatchObject({ value: 4, source: "libby" });
    expect(rows.find((row) => row.field === "shelves")).toMatchObject({ value: ["Favorites"], source: "fable" });
    expect(rows.some((row) => row.field === "finished")).toBe(false);
  });
  it("keeps Libby authoritative even when Fable is newer, including false and zero", () => {
    const rows = reconcileSnapshots(
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            readingProgress: { value: 0, updatedAt: "2026-01-02T00:00:00Z" },
            checkedOut: { value: false },
            finished: { value: false },
          },
        },
      ],
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            readingProgress: { value: 100, updatedAt: "2026-01-03T00:00:00Z" },
            checkedOut: { value: true },
            finished: { value: true },
          },
        },
      ],
    );

    expect(rows.map(({ field, value, source }) => ({ field, value, source }))).toEqual([
      { field: "checkedOut", value: false, source: "libby" },
      { field: "finished", value: false, source: "libby" },
      { field: "readingProgress", value: 0, source: "libby" },
    ]);
  });

  it("uses the newer timestamp in either direction and conflicts on ties or missing timestamps", () => {
    const rows = reconcileSnapshots(
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            olderLibby: { value: "libby", updatedAt: "2026-01-01T00:00:00Z" },
            newerLibby: { value: "libby", updatedAt: "2026-01-03T00:00:00Z" },
            tie: { value: "libby", updatedAt: "2026-01-02T00:00:00Z" },
            missingTime: { value: "libby" },
            offsetTie: { value: "libby", updatedAt: "2026-01-02T01:00:00+01:00" },
            fractional: { value: "libby", updatedAt: "2026-01-02T00:00:00.100Z" },
          },
        },
      ],
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            olderLibby: { value: "fable", updatedAt: "2026-01-02T00:00:00Z" },
            newerLibby: { value: "fable", updatedAt: "2026-01-01T00:00:00Z" },
            tie: { value: "fable", updatedAt: "2026-01-02T00:00:00Z" },
            missingTime: { value: "fable", updatedAt: "2026-01-04T00:00:00Z" },
            offsetTie: { value: "fable", updatedAt: "2026-01-02T00:00:00Z" },
            fractional: { value: "fable", updatedAt: "2026-01-02T00:00:00.099Z" },
          },
        },
      ],
    );

    expect(rows.find((row) => row.field === "olderLibby")).toMatchObject({ value: "fable", source: "fable" });
    expect(rows.find((row) => row.field === "newerLibby")).toMatchObject({ value: "libby", source: "libby" });
    expect(rows.find((row) => row.field === "tie")).toMatchObject({ conflict: expect.any(String) });
    expect(rows.find((row) => row.field === "missingTime")).toMatchObject({ conflict: expect.any(String) });
    expect(rows.find((row) => row.field === "offsetTie")).toMatchObject({ conflict: expect.any(String) });
    expect(rows.find((row) => row.field === "fractional")).toMatchObject({ value: "libby", source: "libby" });
  });

  it("does not resolve a status from Fable alone and resolves identical values without timestamps", () => {
    const rows = reconcileSnapshots(
      [{ bookId: "b1", workId: "shared-b1", title: "One", fields: { tags: { value: ["a", "b"] } } }],
      [
        {
          bookId: "b1",
          workId: "shared-b1",
          title: "One",
          fields: {
            readingProgress: { value: 25 },
            tags: { value: ["a", "b"], updatedAt: "2026-01-03T00:00:00Z" },
          },
        },
      ],
    );

    expect(rows.find((row) => row.field === "readingProgress")).toMatchObject({ conflict: expect.any(String) });
    expect(rows.find((row) => row.field === "tags")).toMatchObject({ value: ["a", "b"], source: "libby" });
  });

  it("rejects duplicate IDs and invalid authority or timestamp values", () => {
    const duplicate = { bookId: "b1", workId: "shared-b1", title: "One", fields: {} };
    expect(() => reconcileSnapshots([duplicate, duplicate], [])).toThrow(/Duplicate bookId/);
    expect(() =>
      reconcileSnapshots(
        [{ bookId: "b1", workId: "shared-b1", title: "One", fields: { readingProgress: { value: 101 } } }],
        [],
      ),
    ).toThrow();
    expect(() =>
      reconcileSnapshots(
        [{ bookId: "b1", workId: "shared-b1", title: "One", fields: { checkedOut: { value: "false" } } }],
        [],
      ),
    ).toThrow();
    expect(() =>
      reconcileSnapshots(
        [
          {
            bookId: "b1",
            workId: "shared-b1",
            title: "One",
            fields: { note: { value: "x", updatedAt: "2026-01-01T00:00:00" } },
          },
        ],
        [],
      ),
    ).toThrow();
  });

  it("groups verified editions, aggregates furthest progress, and lets finished override Fable status", () => {
    const result = reconcileSnapshotsDetailed(
      [
        {
          bookId: "libby-ebook",
          workId: "work-1",
          title: "The Work: Ebook",
          author: "Author Name",
          fields: { readingProgress: { value: 45 }, checkedOut: { value: false }, finished: { value: false } },
        },
        {
          bookId: "libby-audio",
          workId: "work-1",
          title: "The Work: Audiobook",
          author: "Author Name",
          fields: { readingProgress: { value: 65 }, checkedOut: { value: true }, finished: { value: true } },
        },
      ],
      [
        {
          bookId: "fable-work",
          workId: "work-1",
          title: "The Work",
          author: "Author Name",
          fields: { readingProgress: { value: 20 }, readingStatus: { value: "currently-reading" } },
        },
      ],
      SYNC_FALLBACKS,
    );
    expect(result.groups).toHaveLength(1);
    expect(result.rows.find((row) => row.field === "readingProgress")).toMatchObject({ value: 65, source: "libby" });
    expect(result.rows.find((row) => row.field === "readingStatus")).toMatchObject({
      value: "finished",
      source: "libby",
    });
  });

  it("requires timestamps for latest progress and an edition choice for choose progress", () => {
    const libby = [
      {
        bookId: "libby-1",
        workId: "work-1",
        title: "Work",
        author: "Author",
        fields: { readingProgress: { value: 40 }, checkedOut: { value: true }, finished: { value: false } },
      },
      {
        bookId: "libby-2",
        workId: "work-1",
        title: "Work",
        author: "Author",
        fields: { readingProgress: { value: 80 }, checkedOut: { value: true }, finished: { value: false } },
      },
    ];
    const fable = [{ bookId: "fable-1", workId: "work-1", title: "Work", author: "Author", fields: {} }];
    expect(
      reconcileSnapshotsDetailed(libby, fable, { ...SYNC_FALLBACKS, progress: "latest" }).rows.find(
        (row) => row.field === "readingProgress",
      ),
    ).toMatchObject({ conflict: expect.stringContaining("timestamps") });
    expect(
      reconcileSnapshotsDetailed(libby, fable, { ...SYNC_FALLBACKS, progress: "choose" }).rows.find(
        (row) => row.field === "readingProgress",
      ),
    ).toMatchObject({ conflict: expect.stringContaining("Choose") });
  });

  it("rejects ambiguous title-author fallback and keeps incomplete status unknown", () => {
    const ambiguous = reconcileSnapshotsDetailed(
      [
        { bookId: "libby-1", title: "Work", author: "Author", fields: {} },
        { bookId: "libby-2", title: "Work", author: "Author", fields: {} },
      ],
      [{ bookId: "fable-1", title: "Work", author: "Author", fields: {} }],
      SYNC_FALLBACKS,
    );
    expect(ambiguous.conflicts).toHaveLength(1);
    expect(() => reconcileSnapshots(ambiguous.libby, ambiguous.fable, SYNC_FALLBACKS)).toThrow(/ambiguous/i);

    const unknown = reconcileSnapshotsDetailed(
      [
        {
          bookId: "libby-1",
          title: "Work",
          author: "Author",
          fields: { checkedOut: { value: true }, finished: { value: false } },
        },
      ],
      [
        {
          bookId: "fable-1",
          title: "Work",
          author: "Author",
          fields: { readingStatus: { value: "currently-reading" } },
        },
      ],
      SYNC_FALLBACKS,
    );
    expect(unknown.rows.find((row) => row.field === "readingStatus")).toMatchObject({
      conflict: expect.stringContaining("unknown"),
    });
  });

  it("clears only an existing currently-reading status when Libby proves not reading", () => {
    const result = reconcileSnapshotsDetailed(
      [
        {
          bookId: "libby-1",
          title: "Work",
          author: "Author",
          fields: { readingProgress: { value: 0 }, checkedOut: { value: false }, finished: { value: false } },
        },
      ],
      [
        {
          bookId: "fable-1",
          title: "Work",
          author: "Author",
          fields: { readingStatus: { value: "currently-reading" } },
        },
      ],
      SYNC_FALLBACKS,
    );
    expect(result.rows.find((row) => row.field === "readingStatus")).toMatchObject({ value: null, source: "libby" });
  });

  it("does not clear a non-current Fable status when Libby proves not reading", () => {
    const result = reconcileSnapshotsDetailed(
      [
        {
          bookId: "libby-1",
          title: "Work",
          author: "Author",
          fields: { checkedOut: { value: false }, finished: { value: false } },
        },
      ],
      [{ bookId: "fable-1", title: "Work", author: "Author", fields: { readingStatus: { value: "want-to-read" } } }],
      SYNC_FALLBACKS,
    );
    expect(result.rows.find((row) => row.field === "readingStatus")).toMatchObject({
      conflict: expect.stringContaining("only"),
    });
  });
});
