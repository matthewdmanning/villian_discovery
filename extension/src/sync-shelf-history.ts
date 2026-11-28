import { z } from "zod";
import type { SyncApplyReport, SyncPlan } from "../../src/sync-plan.ts";

const historySchema = z.array(
  z.object({
    bookId: z.string(),
    title: z.string(),
    progress: z.number().min(0).max(100).optional(),
    loanIds: z.array(z.string()).min(1),
    /** When a pending loan was first seen returned (ms since epoch). */
    returnedAt: z.number().optional(),
  }),
);

/** A returned loan's reminder lasts this long after it is first seen returned. */
export const RETURNED_REMINDER_MS = 30 * 24 * 60 * 60 * 1_000;
/** At most this many returned-loan reminders are kept, newest first. */
export const MAX_RETURNED_REMINDERS = 50;

/** Use this function to update observed pending Shelf entries from a complete `plan` and untrusted `stored` cache, or clear verified changes from its `report`. Only Libby display data is retained. Returned loans are kept for `RETURNED_REMINDER_MS` after `now`, at most `MAX_RETURNED_REMINDERS` of them. */
export function shelfHistory(stored: unknown, plan: SyncPlan, report?: SyncApplyReport, now = Date.now()) {
  const recent = historySchema.safeParse(stored).data ?? [];
  const current = new Set(
    plan.snapshots.libby.filter((book) => book.fields.checkedOut?.value === true).map((book) => book.bookId),
  );
  const review = new Set(plan.conflicts.flatMap((conflict) => conflict.libbyBookIds));
  const successes = new Set(
    report?.outcomes.filter((outcome) => outcome.status === "success").map((outcome) => outcome.operationId),
  );
  if (!plan.schemas.fable.length) return recent;
  const entries: z.infer<typeof historySchema> = recent
    .filter((book) => !book.loanIds.some((id) => current.has(id)))
    .map((book) => ({ ...book, returnedAt: book.returnedAt ?? now }))
    .filter((book) => now - book.returnedAt < RETURNED_REMINDER_MS)
    .sort((left, right) => right.returnedAt - left.returnedAt)
    .slice(0, MAX_RETURNED_REMINDERS);
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
