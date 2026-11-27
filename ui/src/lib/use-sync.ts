import { useEffect, useState } from "react";
import { SYNC_FALLBACKS, type SyncSettings } from "../../../src/sync-config.ts";
import type { SyncApprovals, SyncPreviewOptions } from "../../../src/sync-plan.ts";
import { useStore } from "./store.tsx";
import { isAppConflict } from "./sync-format.ts";
import { summarizeSyncResult } from "./sync-state.ts";

export function useSync() {
  const {
    api,
    syncResult,
    setSyncResult,
    syncBusy: busy,
    setSyncBusy: setBusy,
    syncError: error,
    setSyncError: setError,
  } = useStore();
  const review: SyncApprovals = syncResult?.review ?? { selected: [], removals: [] };
  const [settings, setSettings] = useState<SyncSettings>();
  const saved = settings !== undefined;

  useEffect(() => {
    let active = true;
    setSettings(undefined);
    api.getSyncSettings().then(
      (value) => {
        if (active) setSettings(value);
      },
      (failure) => {
        if (active) {
          setSettings({ ...SYNC_FALLBACKS });
          setError(`Saved settings could not be loaded: ${String(failure)}. Default settings are used.`);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, setError]);

  /** Use this function to save validated user overrides as soon as they change; clearing the result makes the preview run again. An empty object restores the shipped fallback values. */
  async function saveSettings(input: unknown) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSettings(await api.saveSyncSettings(input));
      setSyncResult(undefined);
    } catch (failure) {
      setError(`Settings were not saved: ${String(failure)}`);
    } finally {
      setBusy(false);
    }
  }

  /** Use this function to update the local comparison only after the API completes successfully; errors preserve the previous result. */
  async function sync(options: SyncPreviewOptions = syncResult?.plan.options ?? {}) {
    if (busy || !saved) return;
    setBusy(true);
    setError(undefined);
    try {
      const plan = await api.previewSync(options);
      setSyncResult({
        rows: plan.rows,
        plan,
        comparedAt: new Date().toISOString(),
        review: {
          selected: plan.operations
            .filter((operation) => !operation.blocked && !operation.removal)
            .map((operation) => operation.id),
          removals: [],
        },
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  // Compare automatically when Sync opens and after each settings change; a failure waits for "Preview changes".
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync reads current state; rerun only when these change.
  useEffect(() => {
    if (saved && !syncResult && !busy && !error) void sync();
  }, [saved, syncResult]);

  /** Use this function to record explicit selections and independent risk approvals for this exact preview. */
  function toggleReview(kind: keyof SyncApprovals, id: string, checked: boolean) {
    if (!syncResult) return;
    const previous = syncResult.review;
    setSyncResult({
      ...syncResult,
      review: {
        ...previous,
        [kind]: checked ? [...new Set([...previous[kind], id])] : previous[kind].filter((value) => value !== id),
      },
    });
  }

  /** Use this function to apply only the trusted plan ID and selected approvals; operation outcomes remain visible across navigation. */
  async function apply() {
    if (busy || !saved || !syncResult) return;
    setBusy(true);
    setError(undefined);
    try {
      const report = await api.applySync(syncResult.plan.id, review);
      setSyncResult({ ...syncResult, report });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const remaining =
    syncResult?.plan.operations.filter(
      (operation) =>
        review.selected.includes(operation.id) &&
        !syncResult.report?.outcomes.some(
          (outcome) => outcome.operationId === operation.id && outcome.status === "success",
        ),
    ) ?? [];
  const operations = syncResult?.plan.operations ?? [];
  const visibleOperations = operations
    .filter((operation) => settings?.showNonConflicting === "yes" || isAppConflict(operation) || operation.create)
    .sort((left, right) => Number(right.removal) - Number(left.removal));
  const missingApproval = remaining.some(
    (operation) => operation.blocked || (operation.removal && !review.removals.includes(operation.id)),
  );

  /** Use this function to select or clear several operations at once, such as every line change for one book. */
  function selectOperations(ids: string[], checked: boolean) {
    if (!syncResult) return;
    const selected = new Set(syncResult.review.selected);
    for (const id of ids) {
      if (checked) selected.add(id);
      else selected.delete(id);
    }
    setSyncResult({ ...syncResult, review: { ...syncResult.review, selected: [...selected] } });
  }

  const outcomeOf = (id: string) => syncResult?.report?.outcomes.find((outcome) => outcome.operationId === id)?.status;
  const resultSummary = syncResult && summarizeSyncResult(syncResult.plan, syncResult.report);

  return {
    api,
    syncResult,
    busy,
    error,
    review,
    settings,
    saved,
    saveSettings,
    sync,
    toggleReview,
    apply,
    remaining,
    visibleOperations,
    missingApproval,
    selectOperations,
    outcomeOf,
    resultSummary,
  };
}
