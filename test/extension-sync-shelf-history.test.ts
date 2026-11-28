import { expect, it } from "vitest";
import { shelfHistory } from "../extension/src/sync-shelf-history.js";
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
  expect(shelfHistory(history, afterReturn)).toEqual(history);
  expect(shelfHistory(undefined, afterReturn)).toEqual([]);
});
