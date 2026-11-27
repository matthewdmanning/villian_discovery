import { z } from "zod";
import type { SyncApplyReport, SyncPlan } from "../../src/sync-plan.ts";

const historySchema = z.array(
  z.object({
    bookId: z.string(),
    title: z.string(),
    progress: z.number().min(0).max(100).optional(),
    loanIds: z.array(z.string()).min(1),
  }),
);

/** Use this function to update observed pending Shelf entries from a complete `plan` and untrusted `stored` cache, or clear verified changes from its `report`. Only Libby display data is retained. */
export function shelfHistory(stored: unknown, plan: SyncPlan, report?: SyncApplyReport) {
  const recent = historySchema.safeParse(stored).data ?? [];
  const current = new Set(
    plan.snapshots.libby.filter((book) => book.fields.checkedOut?.value === true).map((book) => book.bookId),
  );
  const review = new Set(plan.conflicts.flatMap((conflict) => conflict.libbyBookIds));
  const successes = new Set(
    report?.outcomes.filter((outcome) => outcome.status === "success").map((outcome) => outcome.operationId),
  );
  const entries = recent.filter((book) => !book.loanIds.some((id) => current.has(id)));
  if (!plan.schemas.fable.length) return recent;
  for (const group of plan.groups) {
    const loans = group.libby.filter((book) => current.has(book.bookId));
    const first = loans[0];
    if (!first) continue;
    const operations = plan.operations.filter((operation) => operation.groupId === group.groupId);
    const pending =
      loans.some((book) => review.has(book.bookId)) ||
      operations.some((operation) => !successes.has(operation.id)) ||
      plan.rows.some((row) => row.groupId === group.groupId && row.conflict && row.libby && row.fable);
    if (!pending) continue;
    const progress = plan.rows.find((row) => row.groupId === group.groupId && row.field === "readingProgress")?.libby
      ?.value;
    entries.push({
      bookId: first.bookId,
      title: group.title,
      loanIds: loans.map((book) => book.bookId),
      ...(typeof progress === "number" ? { progress } : {}),
    });
  }
  return entries;
}
