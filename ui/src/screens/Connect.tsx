import { CircleCheck, CircleDashed, Plug } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Advanced, Field, Panel, Screen, sz } from "../components/ui.tsx";
import { labelFor } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

export function Connect() {
  const { api, config, set, go } = useStore();
  const tokenFile = config.auth.tokenFile;
  const [connected, setConnected] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setConnected(undefined);
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
    };
  }, [api, tokenFile]);

  // Start sign-in as soon as the app knows it is not connected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: start once per "not connected" result.
  useEffect(() => {
    if (connected === false && !error) void signIn();
  }, [connected]);

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.login(tokenFile);
      setConnected(true);
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

      {connected === false && (
        <Panel className="max-w-xl">
          <form onSubmit={signIn} className="space-y-2">
            <p className="text-sm opacity-70">
              A Libby window opens. This page continues on its own after you finish there.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>At "Do you have a library card?", choose Yes.</li>
              <li>Sign in with your library card.</li>
              <li>
                Already use Libby on your phone? Choose Recover Your Data, then Display Setup Code. On your phone, open
                Libby, go to Menu, then Copy To Another Device, and enter that code.
              </li>
            </ol>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end pt-2">
              <button type="submit" className={`btn btn-primary btn-pop ${sz("btn")}`} disabled={busy}>
                {busy ? <span className="loading loading-spinner loading-sm" /> : <Plug className="size-4" />}
                {error ? "Try again" : "Sign in to Libby"}
              </button>
            </div>
          </form>
        </Panel>
      )}

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
