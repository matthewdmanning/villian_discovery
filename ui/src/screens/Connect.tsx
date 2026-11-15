import { CircleCheck, CircleDashed, Plug } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Advanced, Field, Panel, Screen, sz } from "../components/ui.tsx";
import { labelFor, screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const codeField = screen("connect")
  ?.regions.flatMap((r) => r.components)
  .find((c) => c.type === "output" && !c.binds);

export function Connect() {
  const { api, config, set, go, login } = useStore();
  const tokenFile = config.auth.tokenFile;
  const [connected, setConnected] = useState<boolean>();
  const [code, setCode] = useState("");
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setConnected(undefined);
    setError(undefined);
    setBusy(false);
    setCode("");
    api.status(tokenFile).then(
      (s) => {
        if (!cancelled) setConnected(s.connected);
      },
      (err) => {
        if (cancelled) return;
        setConnected(false);
        setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [api, tokenFile]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      await login({ signal: attempt.signal, onCode: (next) => setCode(next) });
      if (!attempt.signal.aborted) {
        setConnected(true);
        setCode("");
      }
    } catch (err) {
      if (!attempt.signal.aborted) {
        setCode("");
        setError((err as Error).message);
      }
    } finally {
      if (!attempt.signal.aborted) setBusy(false);
    }
  }

  function cancel() {
    controller.current?.abort();
    setBusy(false);
    setCode("");
  }

  return (
    <Screen id="connect">
      <div
        role="status"
        className={`alert border-2 border-pop shadow-pop-sm ${connected ? "alert-success" : "alert-info"}`}
      >
        {connected ? <CircleCheck className="size-5" /> : <CircleDashed className="size-5" />}
        <span className="font-semibold">
          {connected === undefined ? "Checking…" : connected ? "Connected" : "Not connected"}
        </span>
        {connected && (
          <button type="button" className="btn btn-sm btn-pop btn-neutral" onClick={() => go("books")}>
            Add books
          </button>
        )}
      </div>

      <Panel className="max-w-xl">
        <form onSubmit={submit} className="space-y-2">
          <Field label={codeField?.label ?? "Setup code"} hint={codeField?.hint}>
            <output className="block font-mono text-2xl tracking-[0.3em] tabular-nums" aria-live="polite">
              {code || "Generate a code to connect this device"}
            </output>
            {code && <p>On your existing Libby device, open Menu → Copy To Another Device → Enter Setup Code.</p>}
            {api.demo && <p className="text-sm opacity-70">Demo pairing completes automatically.</p>}
            {error && <p className="label text-error">{error}</p>}
          </Field>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className={`btn btn-primary btn-pop ${sz("btn")}`}
              disabled={busy || connected === undefined}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : <Plug className="size-4" />}
              {busy ? "Waiting for approval…" : "Display setup code"}
            </button>
            {busy && (
              <button type="button" className="btn btn-ghost" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </Panel>

      <div className="max-w-xl">
        <Advanced title="Advanced">
          <Field label={labelFor("connect", "auth.tokenFile", "Token file")}>
            <input
              className={`input w-full font-mono text-sm ${sz("input")}`}
              disabled={busy}
              value={tokenFile}
              onChange={(e) => set("auth.tokenFile", e.target.value || undefined)}
            />
          </Field>
        </Advanced>
      </div>
    </Screen>
  );
}
