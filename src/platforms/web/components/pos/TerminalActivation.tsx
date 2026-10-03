/**
 * Full-screen activation gate for the Windows till, plus the lock screen the
 * kill-switch drops in when management revokes the machine.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
  ActivationError,
  activateWithTokenId,
  clearPairingRequest,
  encodePairingRequest,
  getPairingRequest,
  type PairingRequest,
  type TerminalConfig,
} from "@/core/activation/terminal-tokens";
import { clearRevocation } from "@/lib/use-revocation-check";
import { writeActivationRecord } from "@/core/activation/activation-record";
import { isCloudConnected } from "@/core/activation/registration-status";
import { subscribeConnectivity } from "@/core/activation/connection-health";
import { CameraScanner } from "@/platforms/web/components/pos/CameraScanner";
import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";
import { useBranding } from "@/lib/branding";
import { isNative } from "@/platform-config/platform";

const qrDataUrl = (value: string) => {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createDataURL(4, 8);
};

function Frame({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  // "bare" drops the full-screen shell so the same activation form can sit
  // inside the Emergency Access hub as one card among several.
  if (bare) {
    return (
      <div className="rounded-xl border border-slate-700/70 bg-slate-900/80 p-4 text-slate-100">
        {children}
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a] p-6 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700/70 bg-slate-900/80 p-6 shadow-[0_0_60px_-15px_rgba(56,189,248,0.45)]">
        {children}
      </div>
    </div>
  );
}

export function TerminalActivation({
  onActivated,
  embedded = false,
}: {
  onActivated: (c: TerminalConfig) => void;
  /** Render as a plain card (Emergency Access hub) instead of a full screen. */
  embedded?: boolean;
}) {
  // Pairing is a cloud round-trip: offline it must stay quiet instead of
  // reporting a verification failure every three seconds.
  const [online, setOnline] = useState(() => isCloudConnected());
  useEffect(() => subscribeConnectivity(() => setOnline(isCloudConnected())), []);
  const branding = useBranding();
  const mobile = isNative();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  /** Set once this till is registered, so the operator can check the details. */
  const [done, setDone] = useState<TerminalConfig | null>(null);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingStopped, setPairingStopped] = useState(false);
  // Minted after mount: the id is random, so generating it during SSR would
  // hydrate a different QR than the server drew and blow up the page.
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getPairingRequest()
      .then((request) => {
        if (!cancelled) setPairing(request);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setPairingStopped(true);
          setError(cause instanceof Error ? cause.message : "Could not prepare secure pairing.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const pairQr = useMemo(
    () => (pairing ? qrDataUrl(encodePairingRequest(pairing)) : ""),
    [pairing],
  );

  const submit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return setError("Paste or scan the activation code first.");
      setBusy(true);
      setError("");
      try {
        const config = await activateTerminal(trimmed);
        clearRevocation();
        await writeActivationRecord({ tokenId: config.tokenId }).catch(() => {});
        setDone(config);
      } catch (e) {
        setError(
          e instanceof ActivationError ? e.message : "Activation failed. Try again in a moment.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // While the operator waits, keep asking whether an administrator approved
  // the pairing request from their phone. Approval activates the till itself.
  useEffect(() => {
    if (!pairing || !online || done || !showPairing || pairingStopped) return;
    let stopped = false;
    let pending = false;
    let timer: number | undefined;
    let attempts = 0;
    const tick = async () => {
      if (pending) return;
      pending = true;
      try {
        const config = await activateWithTokenId(pairing);
        if (config && !stopped) {
          clearRevocation();
          await writeActivationRecord({ tokenId: config.tokenId }).catch(() => {});
          setDone(config);
        }
      } catch (e) {
        if (!stopped && e instanceof ActivationError) {
          setError(e.message);
          // Network failures recover automatically; token verdicts need a new
          // request and must not hammer the API every three seconds forever.
          if (!/cannot reach|connection/i.test(e.message)) setPairingStopped(true);
        }
      } finally {
        pending = false;
        attempts += 1;
        if (!stopped)
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
  }, [pairing, online, done, showPairing, pairingStopped]);

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

        <dl className="mt-4 space-y-2 rounded-lg border border-border bg-surface-2 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Terminal</dt>
            <dd className="truncate font-medium">{done.deviceName || "This terminal"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Terminal ID</dt>
            <dd className="truncate font-mono text-xs">{done.tokenId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="truncate font-medium">{done.locationName || done.locationId || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="font-medium text-emerald-600 dark:text-emerald-400">Active</dd>
          </div>
        </dl>

        <Button className="mt-4 w-full" onClick={() => onActivated(done)}>
          Continue
        </Button>
      </Frame>
    );
  }

  return (
    <Frame bare={embedded}>
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/40">
          <ShieldCheck className="size-6" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Activate this {mobile ? "phone or tablet" : "Windows till"}</h1>
          <p className="text-xs text-slate-400">
            {branding.company} · {branding.terminal}
          </p>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-400">
        Ask a supervisor or administrator for {mobile ? "a mobile terminal" : "a Windows till"} activation code
        for this location. Scan the QR code or paste the text block below. This code registers the
        device; each staff member signs in with their own account afterward.
      </p>

      <Tabs defaultValue="scan" className="mt-4">
        <TabsList className="grid w-full grid-cols-2 bg-slate-800/60">
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
                  void submit(text);
                }}
                onClose={() => setScanning(false)}
              />
              <Button
                variant="ghost"
                className="w-full text-slate-300"
                onClick={() => setScanning(false)}
              >
                Cancel scanning
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full border-slate-700 bg-slate-800/60 text-slate-100 hover:bg-slate-800"
              onClick={() => setScanning(true)}
            >
              <Camera className="size-4" /> Scan the activation QR code
            </Button>
          )}
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-2">
          <Label htmlFor="activation-code" className="text-xs text-slate-400">
            One-time activation token
          </Label>
          <Textarea
            id="activation-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder="ENC_V1:…"
            className="border-slate-700 bg-slate-950/60 font-mono text-xs text-slate-100"
          />
          <Button
            variant="ghost"
            className="w-full text-slate-300"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
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

      {!mobile && <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50">
        <button
          type="button"
          onClick={() => setShowPairing((v) => !v)}
          className="flex w-full items-center justify-between p-3 text-sm font-medium text-slate-200"
        >
          <span className="flex items-center gap-2">
            <Smartphone className="size-4 text-sky-400" /> Pair from the phone app
          </span>
          <ChevronDown className={`size-4 transition ${showPairing ? "rotate-180" : ""}`} />
        </button>
        {showPairing && (
          <div className="border-t border-slate-800 p-3">
            <p className="text-xs text-slate-400">
              Scan this code from Settings → Terminal activation on the Android app and approve it.
              This till registers itself — nothing to type or copy.
            </p>
            <div className="mt-3 flex items-center gap-3">
              {pairQr ? (
                <img
                  src={pairQr}
                  alt="Pairing code for this terminal"
                  className="size-32 rounded-lg bg-white p-1"
                />
              ) : (
                <div className="grid size-32 place-items-center rounded-lg border border-slate-700 bg-slate-900">
                  <Loader2 className="size-5 animate-spin text-slate-500" />
                </div>
              )}
              <div className="text-[11px] text-slate-500">
                <p className="font-mono break-all text-slate-400">
                  {pairing ? `${pairing.tokenId.slice(0, 8)}…` : "Preparing…"}
                </p>
                <p className="mt-2 flex items-center gap-1">
                  {pairingStopped ? (
                    <>{error ? "Pairing preparation stopped." : "Approval expired or belongs to another device."}</>
                  ) : online ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Waiting for approval…
                    </>
                  ) : (
                    <>Waiting for a connection…</>
                  )}
                </p>
                {pairingStopped && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 border-slate-700 bg-slate-900"
                    onClick={() => {
                      clearPairingRequest();
                      setPairing(null);
                      void getPairingRequest()
                        .then(setPairing)
                        .catch((cause: unknown) => {
                          setPairingStopped(true);
                          setError(
                            cause instanceof Error ? cause.message : "Could not prepare secure pairing.",
                          );
                        });
                      setPairingStopped(false);
                      setError("");
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

      {!online && (
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">
          No connection to the central database right now. Activation needs one — this screen will
          pick up automatically as soon as the link is back.
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button
        className="mt-4 h-11 w-full bg-sky-500 text-slate-950 hover:bg-sky-400"
        disabled={busy || !online}
        onClick={() => void submit(code)}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        Activate terminal
      </Button>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
        <ScanLine className="size-3.5" /> The code links this machine to one location.
      </p>

      {/* A till that cannot be activated — wrong address, no network, nothing
          configured yet — still needs the repair screen. Never a dead end. */}
      {!embedded && (
        <div className="mt-4 flex justify-center">
          <EmergencyAccessLink className="border-slate-700 bg-slate-800/60 text-slate-200 hover:bg-slate-800" />
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
  return (
    <Frame>
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-red-500/15 text-red-400 ring-1 ring-red-500/40">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-red-300">
          {missing
            ? "This terminal is no longer registered on the database."
            : "This device's authorization has been revoked by the master administrator."}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {missing
            ? "Its registration record was removed, so the register is locked and cloud sync is blocked. Ask an administrator for a new activation code."
            : "Cloud sync is blocked and the register is locked. Contact head office for a new activation code."}
        </p>
        <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          This lock cannot be dismissed on the terminal. An administrator must register the
          device again through the controlled recovery process.
        </p>
      </div>
    </Frame>
  );
}
