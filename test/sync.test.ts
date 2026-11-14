import { describe, expect, it } from "vitest";
import { reconcileSnapshots } from "../src/sync.js";

describe("reconcileSnapshots", () => {
  it("preserves explicit clearing and metadata present in only one source", () => {
    const rows = reconcileSnapshots(
      [
        {
          bookId: "b1",
          title: "One",
          fields: { notes: { value: null, updatedAt: "2026-01-03T00:00:00Z" }, rating: { value: 4 } },
        },
      ],
      [
        {
          bookId: "b1",
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
      [{ bookId: "b1", title: "One", fields: { tags: { value: ["a", "b"] } } }],
      [
        {
          bookId: "b1",
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
    const duplicate = { bookId: "b1", title: "One", fields: {} };
    expect(() => reconcileSnapshots([duplicate, duplicate], [])).toThrow(/Duplicate bookId/);
    expect(() =>
      reconcileSnapshots([{ bookId: "b1", title: "One", fields: { readingProgress: { value: 101 } } }], []),
    ).toThrow();
    expect(() =>
      reconcileSnapshots([{ bookId: "b1", title: "One", fields: { checkedOut: { value: "false" } } }], []),
    ).toThrow();
    expect(() =>
      reconcileSnapshots(
        [{ bookId: "b1", title: "One", fields: { note: { value: "x", updatedAt: "2026-01-01T00:00:00" } } }],
        [],
      ),
    ).toThrow();
  });
});
