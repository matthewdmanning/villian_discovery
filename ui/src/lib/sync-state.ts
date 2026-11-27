import type { SyncApplyReport, SyncPlan } from "../../../src/sync-plan.ts";

/** Use plan counts, not provider payloads, to describe a completed preview or apply in plain language. */
export function summarizeSyncResult(
  plan: Pick<SyncPlan, "operations">,
  report?: Pick<SyncApplyReport, "outcomes">,
): { status: "Success" | "Fail"; summary: string } {
  if (report) {
    const applied = report.outcomes.filter((outcome) => outcome.status === "success").length;
    const failed = report.outcomes.length - applied;
    if (failed > 0)
      return {
        status: "Fail",
        summary: `${applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}; ` : ""}${failed} change${failed === 1 ? "" : "s"} could not be confirmed. Review the changes and try again.`,
      };
    return {
      status: "Success",
      summary: applied ? `Applied ${applied} change${applied === 1 ? "" : "s"}.` : "No changes were applied.",
    };
  }

  const reviewable = plan.operations.filter((operation) => !operation.blocked).length;
  return {
    status: "Success",
    summary: reviewable
      ? `${reviewable} change${reviewable === 1 ? "" : "s"} found. Review before applying.`
      : plan.operations.length
        ? `${plan.operations.length} change${plan.operations.length === 1 ? " requires" : "s require"} review before applying.`
        : "No changes needed.",
  };
}
