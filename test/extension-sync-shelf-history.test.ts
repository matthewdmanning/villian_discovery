import { describe, expect, it } from "vitest";
import { MAX_RETURNED_REMINDERS, RETURNED_REMINDER_MS, shelfHistory } from "../extension/src/sync-shelf-history.js";
import type { BookSnapshot } from "../src/sync.js";
import { previewSync, type SyncAdapters } from "../src/sync-plan.js";

it("retains a previously observed pending loan after return and clears a verified add", async () => {
  const loan: BookSnapshot = {
    bookId: "libby:one",
    title: "One Book",
    fields: { checkedOut: { value: true }, readingProgress: { value: 20 } },
  };
  let loans = [loan];
  const adapters: SyncAdapters = {
    libby: {
      verified: true,
      fields: ["checkedOut", "readingProgress"],
      writableFields: [],
      read: async () => loans,
      write: async () => {},
    },
    fable: {
      verified: true,
      fields: ["readingStatus"],
      writableFields: [],
      createFields: ["readingStatus"],
      read: async () => [],
      write: async () => {},
    },
  };
  const input = { context: { userId: "user", connectionId: "connection" }, settings: {}, adapters };
  const plan = await previewSync(input);
  const history = shelfHistory(undefined, plan);
  expect(history).toEqual([{ bookId: "libby:one", title: "One Book", loanIds: ["libby:one"], progress: 20 }]);
  expect(
    shelfHistory(history, plan, {
      planId: plan.id,
      outcomes: [{ operationId: plan.operations[0]!.id, status: "success", message: "Verified" }],
    }),
  ).toEqual([]);
  loans = [];
  const afterReturn = await previewSync({ ...input, options: { matches: { "libby:one": "fable:one" } } });
  expect(afterReturn.options.matches).toEqual({});
  expect(afterReturn.operations).toEqual([]);
  expect(shelfHistory(history, afterReturn, undefined, 1_000)).toEqual([{ ...history[0], returnedAt: 1_000 }]);
  expect(shelfHistory(undefined, afterReturn)).toEqual([]);
});

describe("returned-loan reminders", () => {
  const plan = (libby: BookSnapshot[] = []) =>
    ({
      snapshots: { libby },
      conflicts: [],
      groups: [],
      operations: [],
      rows: [],
      schemas: { fable: ["readingStatus"] },
    }) as never;
  const returned = (bookId: string, returnedAt?: number) => ({
    bookId,
    title: bookId,
    loanIds: [bookId],
    ...(returnedAt === undefined ? {} : { returnedAt }),
  });

  it("keeps the first time a loan was seen returned", () => {
    const first = shelfHistory([returned("a")], plan(), undefined, 5_000);
    expect(shelfHistory(first, plan(), undefined, 9_000)).toEqual([returned("a", 5_000)]);
  });

  it("drops a reminder once it is older than the reminder period", () => {
    const now = 100 * RETURNED_REMINDER_MS;
    const kept = returned("kept", now - RETURNED_REMINDER_MS + 1);
    expect(shelfHistory([returned("old", now - RETURNED_REMINDER_MS), kept], plan(), undefined, now)).toEqual([kept]);
  });

  it("keeps only the newest reminders", () => {
    const stored = Array.from({ length: MAX_RETURNED_REMINDERS + 5 }, (_, index) => returned(`b${index}`, index));
    const kept = shelfHistory(stored, plan(), undefined, 1_000);
    expect(kept).toHaveLength(MAX_RETURNED_REMINDERS);
    expect(kept[0]).toEqual(returned(`b${MAX_RETURNED_REMINDERS + 4}`, MAX_RETURNED_REMINDERS + 4));
    expect(kept.at(-1)).toEqual(returned("b5", 5));
  });

  it("leaves stored entries alone when Fable is not connected", () => {
    const stored = [returned("a")];
    expect(shelfHistory(stored, { ...(plan() as object), schemas: { fable: [] } } as never, undefined, 1)).toEqual(
      stored,
    );
  });
});
