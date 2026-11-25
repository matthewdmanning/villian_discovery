import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Panel, Screen } from "../components/ui.tsx";
import { useStore } from "../lib/store.tsx";

/** Read the unverified Libby tags endpoint without interpreting an unknown response shape. */
export function TagsScreen() {
  const { api, go } = useStore();
  const [result, setResult] = useState<{ data: unknown }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult({ data: await api.tags() });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen id="tags">
      <Panel className="space-y-4">
        <p>Explore your Libby tags. This feature is experimental, so the response may not yet be easy to read.</p>
        {api.demo && <p className="text-sm">Demo data is shown here, not your Libby account.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary btn-pop" disabled={busy} onClick={() => void load()}>
            {busy ? <span className="loading loading-spinner loading-sm" /> : <RefreshCw className="size-4" />}
            {busy ? "Loading tags…" : result ? "Refresh tags" : "Load tags"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => go("connect")}>
            Connect Libby
          </button>
        </div>
        {busy && <p role="status">Loading tags from {api.demo ? "the demo" : "Libby"}…</p>}
        {error && (
          <p role="alert" className="text-error">
            Could not load tags: {error}
          </p>
        )}
        {result && (
          <section aria-labelledby="tags-response-title" className="space-y-2">
            <h2 id="tags-response-title" className="text-lg font-semibold">
              Tag data
            </h2>
            <p className="text-sm opacity-70">The format and contents of this response have not yet been verified.</p>
            <pre className="overflow-x-auto rounded-field bg-base-200 p-4 text-sm whitespace-pre-wrap break-all">
              {JSON.stringify(result.data, null, 2) ?? "No data returned."}
            </pre>
          </section>
        )}
      </Panel>
    </Screen>
  );
}
