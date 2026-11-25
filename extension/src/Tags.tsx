import { useEffect, useState } from "react";
import { Screen } from "../../ui/src/components/ui.tsx";
import { cachedTags, type LibbyTag, tags } from "./extension-api.ts";

/** Use this component to restore cached Libby tags and refresh them on demand. */
export function Tags() {
  const [result, setResult] = useState<LibbyTag[]>();
  const [fromCache, setFromCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "failure">();
  useEffect(() => {
    let active = true;
    void cachedTags()
      .then((next) => {
        if (active && next !== undefined) {
          setResult(next);
          setFromCache(true);
        }
      })
      .catch(() => {
        if (active) {
          setOutcome("failure");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const load = async () => {
    setBusy(true);
    setOutcome(undefined);
    try {
      const next = await tags();
      setResult(next);
      setFromCache(false);
      setOutcome("success");
    } catch {
      setOutcome("failure");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="tags">
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void load()}>
          {busy ? "Loading…" : result === undefined ? "Load tags" : "Refresh tags"}
        </button>
      </div>
      {busy ? (
        <p role="status" className="text-sm opacity-70">
          Loading tags from Libby…
        </p>
      ) : (
        <>
          {outcome === "success" && (
            <p role="status" className="text-sm text-success">
              Success · Loaded {result?.length ?? 0} {result?.length === 1 ? "tag" : "tags"}.
            </p>
          )}
          {outcome === "failure" && (
            <p role="alert" className="text-sm text-error">
              Fail ·{" "}
              {result === undefined
                ? "Tags could not be loaded."
                : "Tags could not be refreshed; existing tags remain shown."}
            </p>
          )}
          {fromCache && (
            <p className="text-sm opacity-70">Cached tags may belong to another Libby account; refresh to verify.</p>
          )}
          {result !== undefined &&
            (result.length ? (
              <ul className="mt-2 space-y-2">
                {result.map((tag) => (
                  <li key={tag.uuid} className="rounded-field bg-base-200 p-3">
                    <div className="font-display font-semibold">{tag.name}</div>
                    {typeof tag.description === "string" && tag.description.trim() && (
                      <div className="text-sm opacity-70">{tag.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 opacity-60">No Libby tags found</p>
            ))}
        </>
      )}
    </Screen>
  );
}
