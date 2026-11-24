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
  const [connection, setConnection] = useState<"checking" | "connected" | "disconnected" | "check-error">("checking");
  const [checkRevision, setCheckRevision] = useState(0);
  const [code, setCode] = useState("");
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [method, setMethod] = useState<SignInMethod>("library card");

  // biome-ignore lint/correctness/useExhaustiveDependencies: retrying explicitly rechecks the connection.
  useEffect(() => {
    let cancelled = false;
    setConnection("checking");
    setError(undefined);
    setBusy(false);
    setCode("");
    api.status(tokenFile).then(
      (s) => {
        if (!cancelled) setConnection(s.connected ? "connected" : "disconnected");
      },
      (err) => {
        if (cancelled) return;
        setConnection("check-error");
        setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, [api, tokenFile, checkRevision]);

  async function signIn(e?: FormEvent) {
    e?.preventDefault();
    if (busy || connection !== "disconnected") return;
    setBusy(true);
    setError(undefined);
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      await login({
        method: method === "phone code" ? "device-code" : "browser",
        signal: attempt.signal,
        onCode: (next) => {
          if (!attempt.signal.aborted) setCode(next);
        },
      });
      if (!attempt.signal.aborted) {
        setConnection("connected");
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

  return (
    <Screen id="connect">
      <div
        role="status"
        className={`alert border-2 border-pop shadow-pop-sm ${connection === "connected" ? "alert-success" : connection === "check-error" ? "alert-error" : "alert-info"}`}
      >
        {connection === "connected" ? <CircleCheck className="size-5" /> : <CircleDashed className="size-5" />}
        <span className="font-semibold">
          {connection === "checking"
            ? "Checking connection to Libby…"
            : connection === "connected"
              ? "Connected to Libby"
              : connection === "check-error"
                ? "Could not check connection"
                : busy
                  ? method === "phone code"
                    ? code
                      ? "Waiting for the setup code to be accepted"
                      : "Getting a setup code…"
                    : "Waiting for you to sign in to Libby"
                  : "Not connected to Libby"}
        </span>
        {connection === "connected" && (
          <button type="button" className="btn btn-sm btn-pop btn-neutral" onClick={() => go("books")}>
            Add books
          </button>
        )}
      </div>

      {connection === "check-error" && (
        <Panel className="max-w-xl">
          <p role="alert" className="text-error">
            {error}
          </p>
          <p className="mt-2">Your connection status is unknown. Try checking again.</p>
          <button type="button" className="btn btn-primary btn-pop mt-4" onClick={() => setCheckRevision((n) => n + 1)}>
            Retry connection check
          </button>
        </Panel>
      )}

      {connection === "disconnected" && (
        <Panel className="max-w-xl">
          <form onSubmit={signIn} className="space-y-2">
            <fieldset disabled={busy}>
              <Segmented<SignInMethod>
                label="Sign in with"
                value={method}
                choices={SIGN_IN_METHODS}
                onChange={setMethod}
              />
            </fieldset>
            <p className="text-sm opacity-70">
              {method === "phone code"
                ? "Get a setup code to enter in Libby on your phone. This page updates when the code is accepted."
                : "Open a Libby window to sign in. This page updates when sign-in is complete."}
            </p>
            {method === "phone code" && (
              <Field label={codeField?.label ?? "Setup code"} hint={codeField?.hint}>
                <output
                  className={code ? "block font-mono text-2xl tracking-[0.3em] tabular-nums" : "block text-base"}
                  aria-live="polite"
                >
                  {code || (busy ? "Getting code…" : "No code yet")}
                </output>
                {api.demo && <p className="text-sm opacity-70">Demo pairing completes automatically.</p>}
              </Field>
            )}
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {SIGN_IN_STEPS[method].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {error && (
              <p role="alert" className="text-sm text-error">
                Sign-in failed: {error}
              </p>
            )}
            {busy && !api.demo && (
              <p className="text-sm opacity-70">Sign-in continues even if you leave this screen.</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="submit" className={`btn btn-primary btn-pop ${sz("btn")}`} disabled={busy}>
                {busy ? <span className="loading loading-spinner loading-sm" /> : <Plug className="size-4" />}
                {busy
                  ? method === "phone code"
                    ? "Waiting for phone…"
                    : "Waiting for Libby…"
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
