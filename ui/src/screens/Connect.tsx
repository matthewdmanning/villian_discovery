import { CircleCheck, CircleDashed, Plug } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Advanced, Field, Panel, Screen, sz } from "../components/ui.tsx";
import { labelFor, screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const codeField = screen("connect")
  ?.regions.flatMap((r) => r.components)
  .find((c) => c.type === "field" && !c.binds);

export function Connect() {
  const { api, config, set, go } = useStore();
  const tokenFile = config.auth.tokenFile;
  const [connected, setConnected] = useState<boolean>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.status(tokenFile).then((s) => setConnected(s.connected));
  }, [api, tokenFile]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.login(code, tokenFile);
      setConnected(true);
      setCode("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
            <input
              className={`input w-full font-mono text-lg tracking-[0.3em] tabular-nums ${sz("input")} ${error ? "input-error" : ""}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="12345678"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            {error && <p className="label text-error">{error}</p>}
          </Field>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className={`btn btn-primary btn-pop ${sz("btn")}`}
              disabled={busy || code.length !== 8}
            >
              {busy ? <span className="loading loading-spinner loading-sm" /> : <Plug className="size-4" />}
              Connect
            </button>
          </div>
        </form>
      </Panel>

      <div className="max-w-xl">
        <Advanced title="Advanced">
          <Field label={labelFor("connect", "auth.tokenFile", "Token file")}>
            <input
              className={`input w-full font-mono text-sm ${sz("input")}`}
              value={tokenFile}
              onChange={(e) => set("auth.tokenFile", e.target.value || undefined)}
            />
          </Field>
        </Advanced>
      </div>
    </Screen>
  );
}
