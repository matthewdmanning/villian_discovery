import { CircleCheck, CircleDashed, Plug } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Advanced, Field, Panel, Screen, Segmented, sz } from "../components/ui.tsx";
import { labelFor, screen } from "../lib/spec.ts";
import { useStore } from "../lib/store.tsx";

const SIGN_IN_METHODS = ["library card", "passkey", "phone code"] as const;
type SignInMethod = (typeof SIGN_IN_METHODS)[number];
// Libby's documented steps: help.libbyapp.com/en-us/6103.htm, 6070.htm, and 6302.htm.
const SIGN_IN_STEPS: Record<SignInMethod, string[]> = {
  "library card": [
    'In the Libby window, at "Do you have a library card?", choose Yes.',
    "Find your library, then sign in with your library card.",
  ],
  passkey: [
    'In the Libby window, at "Do you have a library card?", choose Yes.',
    "Choose Recover Your Data, then Recover With Passkey.",
    "Confirm with your device PIN or fingerprint.",
    "No passkey yet? In Libby on your phone, go to Menu, then Back Up Your Data, then Create Recovery Passkey.",
  ],
  "phone code": ["On your phone, open Libby, go to Menu, then Copy To Another Device, then Enter Setup Code."],
};

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
  const [method, setMethod] = useState<SignInMethod>("library card");

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
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      await login({
        method: method === "phone code" ? "device-code" : "browser",
        signal: attempt.signal,
        onCode: (next) => setCode(next),
      });
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

  /** Use this function to switch sign-in methods; a running attempt stops so the new method can start. */
  function choose(next: SignInMethod) {
    cancel();
    setMethod(next);
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
            <Segmented<SignInMethod> label="Sign in with" value={method} choices={SIGN_IN_METHODS} onChange={choose} />
            <p className="text-sm opacity-70">
              {method === "phone code"
                ? "This page shows a setup code. It continues on its own after your phone accepts it."
                : "A Libby window opens. This page continues on its own after you finish there."}
            </p>
            {method === "phone code" && (
              <Field label={codeField?.label ?? "Setup code"} hint={codeField?.hint}>
                <output className="block font-mono text-2xl tracking-[0.3em] tabular-nums" aria-live="polite">
                  {code || "Generate a code to connect this device"}
                </output>
                {api.demo && <p className="text-sm opacity-70">Demo pairing completes automatically.</p>}
              </Field>
            )}
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {SIGN_IN_STEPS[method].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              {busy && (
                <button type="button" className="btn btn-ghost" onClick={cancel}>
                  Cancel
                </button>
              )}
              <button type="submit" className={`btn btn-primary btn-pop ${sz("btn")}`} disabled={busy}>
                {busy ? <span className="loading loading-spinner loading-sm" /> : <Plug className="size-4" />}
                {busy
                  ? "Waiting…"
                  : error
                    ? "Try again"
                    : method === "phone code"
                      ? "Display setup code"
                      : "Sign in to Libby"}
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
