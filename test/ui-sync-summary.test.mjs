import { expect, it } from "vitest";
import { summarizeSyncResult } from "../ui/src/screens/Sync.tsx";

const plan = (operations) => ({ operations });
const operation = (id, blocked) => ({ id, title: `Book ${id}`, ...(blocked ? { blocked } : {}) });

it("keeps blocked preview changes visible as requiring review", () => {
  expect(summarizeSyncResult(plan([operation("one"), operation("two", "Needs review")]))).toEqual({
    status: "Success",
    summary: "1 change found. Review before applying.",
  });
  expect(summarizeSyncResult(plan([operation("one", "Needs review")]))).toEqual({
    status: "Success",
    summary: "1 change requires review before applying.",
  });
});

it("reports apply failures as a plain status", () => {
  expect(
    summarizeSyncResult(plan([operation("one"), operation("two")]), {
      outcomes: [
        { operationId: "one", status: "success", message: "raw provider detail" },
        { operationId: "two", status: "failed", message: "raw provider detail" },
      ],
    }),
  ).toEqual({
    status: "Fail",
    summary: "Applied 1 change; 1 change could not be confirmed. Review the changes and try again.",
  });
});

it("reports successful apply as a plain status", () => {
  expect(
    summarizeSyncResult(plan([operation("one"), operation("two")]), {
      outcomes: [
        { operationId: "one", status: "success", message: "raw provider detail" },
        { operationId: "two", status: "success", message: "raw provider detail" },
      ],
    }),
  ).toEqual({
    status: "Success",
    summary: "Applied 2 changes.",
  });
});

it("uses plural wording when several changes need review", () => {
  expect(summarizeSyncResult(plan([operation("one", "Needs review"), operation("two", "Needs review")]))).toEqual({
    status: "Success",
    summary: "2 changes require review before applying.",
  });
});

it("says when a completed apply changed nothing, and when a preview found nothing", () => {
  expect(summarizeSyncResult(plan([]), { outcomes: [] })).toEqual({
    status: "Success",
    summary: "No changes were applied.",
  });
  expect(summarizeSyncResult(plan([]))).toEqual({ status: "Success", summary: "No changes needed." });
  expect(
    summarizeSyncResult(plan([]), {
      outcomes: [
        { operationId: "a", status: "success" },
        { operationId: "b", status: "success" },
      ],
    }),
  ).toEqual({ status: "Success", summary: "Applied 2 changes." });
});
