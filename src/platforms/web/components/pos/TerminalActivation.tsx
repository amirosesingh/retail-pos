import { readText } from "@/platform-config/clipboard";
/**
 * Full-screen activation gate for the Windows till, plus the lock screen the
 * kill-switch drops in when management revokes the machine.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ClipboardPaste,
  KeyRound,
  Loader2,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  activateTerminal,
  readTerminalConfig,
  ActivationError,
  activateWithTokenId,
  clearPairingRequest,
  encodePairingRequest,
  getPairingRequest,
  isRetryableActivationError,
  type PairingRequest,
  type TerminalConfig,
} from "@/core/activation/terminal-tokens";
import { clearRevocation } from "@/lib/use-revocation-check";
import { writeActivationRecord } from "@/core/activation/activation-record";
import { CameraScanner } from "@/platforms/web/components/pos/CameraScanner";
import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";
import { useBranding } from "@/lib/branding";
import { isNative } from "@/platform-config/platform";
import { TerminalRegistrationDetails } from "@/components/shared/TerminalRegistrationDetails";
import { serverOrigin } from "@/lib/server-origin";

const qrDataUrl = (value: string) => {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createDataURL(8, 32);
};

function Frame({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  // "bare" drops the full-screen shell so the same activation form can sit
  // inside the Emergency Access hub as one card among several.
  if (bare) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-foreground">
        {children}
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}

export function TerminalActivation({
  onActivated,
  embedded = false,
  onActivationStarted,
  beforeActivation,
}: {
  onActivated: (c: TerminalConfig) => void;
  /** Render as a plain card (Emergency Access hub) instead of a full screen. */
  embedded?: boolean;
  onActivationStarted?: () => void;
  /** Recovery rechecks native authorization and pending work before each claim. */
  beforeActivation?: () => Promise<void>;
}) {
  const branding = useBranding();
  const mobile = isNative();
  const [replacingRegistration] = useState(() => mobile && Boolean(readTerminalConfig()?.tokenId));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // React state is not synchronous: camera callbacks can arrive twice before
  // the disabled button renders. Keep one activation in flight per screen.
  const activationPending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const continued = useRef(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  /** Set once this till is registered, so the operator can check the details. */
  const [done, setDone] = useState<TerminalConfig | null>(null);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingStopped, setPairingStopped] = useState(false);
  const [pairingApproved, setPairingApproved] = useState(false);
  const [pairingError, setPairingError] = useState("");
  // Minted after mount: the id is random, so generating it during SSR would
  // hydrate a different QR than the server drew and blow up the page.
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  useEffect(() => {
    // Android consumes activation codes; only a Windows till displays a pairing request.
    if (mobile) return;
    let cancelled = false;
    void getPairingRequest()
      .then((request) => {
        if (!cancelled) setPairing(request);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPairingStopped(true);
          setPairingError(cause instanceof ActivationError ? cause.message : "Could not prepare secure pairing. Try starting a new pairing request.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mobile]);
  const pairQr = useMemo(
    () => (pairing ? qrDataUrl(encodePairingRequest(pairing)) : ""),
    [pairing],
  );

  const finish = useCallback(async (config: TerminalConfig) => {
    if (!mounted.current) return;
    clearRevocation();
    await writeActivationRecord({ tokenId: config.tokenId }).catch(() => {});
    if (mounted.current) setDone(config);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      if (activationPending.current || done) return;
      const trimmed = value.trim();
      if (!trimmed) return setError("Paste or scan the activation code first.");
      activationPending.current = true;
      setBusy(true);
      setError("");
      try {
        if (beforeActivation) await beforeActivation();
        onActivationStarted?.();
        await finish(await (beforeActivation ? activateTerminal(trimmed, beforeActivation) : activateTerminal(trimmed)));
      } catch (e) {
        setError(
          e instanceof ActivationError ? e.message : isRetryableActivationError(e)
            ? "Could not reach the activation service. Check the connection and try again."
            : "Could not complete activation on this device. Try the same token again.",
        );
      } finally {
        activationPending.current = false;
        setBusy(false);
      }
    },
    [onActivationStarted, beforeActivation, done, finish],
  );

  // The hosted pairing endpoint decides whether the request can proceed.
  // The general database heartbeat may be stale while repairing a profile.
  useEffect(() => {
    if (!pairing || done || !showPairing || pairingStopped || scanning) return;
    let stopped = false;
    let timer: number | undefined;
    let attempts = 0;
    const tick = async () => {
      if (stopped) return;
      if (activationPending.current) {
        timer = window.setTimeout(() => void tick(), 3_000);
        return;
      }
      activationPending.current = true;
      setBusy(true);
      let retry = false;
      try {
        if (beforeActivation) await beforeActivation();
        onActivationStarted?.();
        const config = await activateWithTokenId(pairing, () => {
          if (!stopped) {
            setPairingApproved(true);
            setPairingError("");
          }
        }, beforeActivation);
        if (config) {
          // A claim that finishes after the operator collapses the pairing
          // panel still belongs to this terminal.
          await finish(config);
        } else if (!stopped) {
          setPairingApproved(false);
          setPairingError("");
          retry = true;
        }
      } catch (e) {
        if (!stopped) {
          retry = e instanceof ActivationError ? e.retryable : isRetryableActivationError(e);
          setPairingError(e instanceof ActivationError ? e.message :
            retry ? "Could not reach the POS website. Check the connection while this terminal retries."
              : "Could not complete pairing on this device. Try starting a new pairing request.");
          if (!retry) setPairingStopped(true);
        }
      } finally {
        activationPending.current = false;
        if (mounted.current) setBusy(false);
        attempts += 1;
        if (!stopped && retry)
          timer = window.setTimeout(
            () => void tick(),
            Math.min(3_000 + attempts * 1_000, 15_000),
          );
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pairing, done, showPairing, pairingStopped, scanning, onActivationStarted, beforeActivation, finish]);

  if (done) {
    return (
      <Frame bare={embedded}>
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/40">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">This terminal is registered</h1>
            <p className="text-xs text-muted-foreground">
              Check the details below, then carry on to the sign-in screen.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Activation verified → Registration approved → Ready to sign in</p>
          <TerminalRegistrationDetails details={{ ...done, backendUrl: done.backendUrl || serverOrigin() }} />
        </div>

        <Button className="mt-4 w-full" onClick={() => {
          if (continued.current) return;
          continued.current = true;
          if (replacingRegistration) window.location.reload();
          else onActivated(done);
        }}>
          Continue
        </Button>
      </Frame>
    );
  }

  return (
    <Frame bare={embedded}>
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <ShieldCheck className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Activate this {mobile ? "phone or tablet" : "Windows till"}</h1>
          <p className="text-xs text-muted-foreground">
            {branding.company} · {branding.terminal}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Ask a supervisor or administrator for {mobile ? "a mobile terminal" : "a Windows till"} activation code
        for a branch or Management. Scan the QR code or paste the text block below. This code registers the
        device; each staff member signs in with their own account afterward.
      </p>

      {replacingRegistration && <p className="mt-2 text-sm text-muted-foreground">
        Scan or enter a new mobile token to change the registered branch or switch to Management.
        A successful change requires staff to sign in again with their existing permissions.
      </p>}
      <Tabs defaultValue="scan" className="mt-4">
        <TabsList className="grid w-full grid-cols-2 bg-muted">
          <TabsTrigger value="scan">
            <Camera className="size-4" /> Scan QR
          </TabsTrigger>
          <TabsTrigger value="manual">
            <KeyRound className="size-4" /> Enter token
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scan" className="mt-4">
          {scanning ? (
            <div className="space-y-2">
              <CameraScanner
                onScan={(text) => {
                  setScanning(false);
                  if (activationPending.current) {
                    setCode(text.trim());
                    setError("An activation check is in progress. Choose Activate terminal when it finishes to use the scanned token.");
                    return;
                  }
                  void submit(text);
                }}
                onClose={() => setScanning(false)}
              />
              <Button
                variant="ghost"
                className="w-full text-foreground"
                onClick={() => setScanning(false)}
              >
                Cancel scanning
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full border-border bg-muted text-foreground hover:bg-accent"
              disabled={busy}
              onClick={() => setScanning(true)}
            >
              <Camera className="size-4" /> Scan the activation QR code
            </Button>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-2">
          <Label htmlFor="activation-code" className="text-xs text-muted-foreground">
            One-time activation token
          </Label>
          <Textarea
            id="activation-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="ENC_V1:…"
            className="border-border bg-background font-mono text-xs text-foreground"
          />
          <Button
            variant="ghost"
            className="w-full text-foreground"
            onClick={async () => {
              try {
                const text = await readText();
                if (text.trim()) setCode(text.trim());
              } catch {
                setError("Could not read the clipboard. Paste the token by hand.");
              }
            }}
          >
            <ClipboardPaste className="size-4" /> Paste from clipboard
          </Button>
        </TabsContent>
      </Tabs>

      {!mobile && <div className="mt-4 rounded-xl border border-border bg-muted/40">
        <button
          type="button"
          onClick={() => setShowPairing((v) => !v)}
          className="flex w-full items-center justify-between p-3 text-sm font-medium text-foreground"
        >
          <span className="flex items-center gap-2">
            <Smartphone className="size-4 text-primary" /> Pair from the phone app
          </span>
          <ChevronDown className={`size-4 transition ${showPairing ? "rotate-180" : ""}`} />
        </button>
        {showPairing && (
          <div className="border-t border-border p-3">
            <p className="text-xs text-muted-foreground">
              Scan this code from Settings → Terminal activation on the Android app and approve it.
              This till registers itself — nothing to type or copy.
            </p>
            <div className="mt-3 flex flex-col items-center gap-3">
              {pairQr ? (
                <img
                  src={pairQr}
                  alt="Pairing code for this terminal"
                  className="aspect-square w-full max-w-96 bg-white p-2 [image-rendering:pixelated]"
                />
              ) : (
                <div className="grid size-32 place-items-center rounded-lg border border-border bg-card">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                <p className="font-mono break-all text-muted-foreground">
                  {pairing ? `${pairing.tokenId.slice(0, 8)}…` : "Preparing…"}
                </p>
                <p className="mt-2 flex items-center gap-1">
                  {pairingStopped ? (
                    <>Pairing stopped.</>
                  ) : pairingError ? (
                    <>Retrying the pairing check…</>
                  ) : (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      {pairingApproved ? "Approved. Finishing registration on this device…" : "Waiting for approval…"}
                    </>
                  )}
                </p>
                {pairingError && <p role="alert" className="mt-2 text-destructive">{pairingError}</p>}
                {pairingStopped && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 border-border bg-card"
                    onClick={async () => {
                      setPairingStopped(false);
                      setPairingApproved(false);
                      setPairingError("");
                      setPairing(null);
                      try {
                        clearPairingRequest();
                        setPairing(await getPairingRequest());
                      } catch (cause) {
                        setPairingStopped(true);
                        setPairingError(cause instanceof ActivationError ? cause.message : "Could not prepare secure pairing. Try again.");
                      }
                    }}
                  >
                    Start a new pairing request
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>}

      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        className="mt-4 h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void submit(code)}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        Activate terminal
      </Button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ScanLine className="size-3.5" /> The code links this machine to one location.
      </p>

      {/* A till that cannot be activated — wrong address, no network, nothing
          configured yet — still needs the repair screen. Never a dead end. */}
      {!embedded && (
        <div className="mt-4 flex justify-center">
          <EmergencyAccessLink className="border-border bg-muted text-foreground hover:bg-accent" />
        </div>
      )}
    </Frame>
  );
}

/** Shown the moment the heartbeat confirms the token was revoked. */
export function TerminalRevokedScreen({
  reason = "revoked",
}: {
  reason?: "revoked" | "missing";
}) {
  const missing = reason === "missing";
  if (isNative()) return <TerminalActivation onActivated={() => window.location.reload()} />;
  return (
    <Frame>
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/15 text-red-400 ring-1 ring-red-500/40">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-destructive">
          {missing
            ? "This terminal is no longer registered on the database."
            : "This device's authorization has been revoked by the master administrator."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {missing
            ? "Its registration record was removed, so the register is locked and cloud sync is blocked. Ask an administrator for a new activation code."
            : "Cloud sync is blocked and the register is locked. Contact head office for a new activation code."}
        </p>
        <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-destructive">
          This lock cannot be dismissed on the terminal. An administrator must register the
          device again through the controlled recovery process.
        </p>
        <div className="mt-4 flex justify-center">
          <EmergencyAccessLink
            label="Administrator recovery"
            className="border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
          />
        </div>
      </div>
    </Frame>
  );
}
