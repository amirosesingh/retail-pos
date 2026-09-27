/**
 * Admin console: issue an activation code for a Windows till and disconnect a
 * machine again at any time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Camera,
  MonitorSmartphone,
  RefreshCw,
  ShieldX,
} from "lucide-react";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import { describeError } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { usePos } from "@/lib/pos-store";
import { logger } from "@/lib/audit-log";
import {
  issueTerminalToken,
  listTerminalTokens,
  reissueTerminalToken,
  revokeTerminalToken,
  decodePairingRequest,
  readTerminalConfig,
  type TerminalToken,
} from "@/core/activation/terminal-tokens";
import { CameraScanner } from "@/platforms/web/components/pos/CameraScanner";
import { fetchTokenStatus } from "@/core/activation/terminal-tokens";
import { ACTIVATION_TTL_MS } from "@/lib/terminal-crypto";
import {
  TERMINAL_STATUS_HINT,
  TERMINAL_STATUS_LABEL,
  sinceWords,
  terminalStatus,
  type TerminalLiveStatus,
} from "@/lib/terminal-status";

const qrDataUrl = (value: string) => {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createDataURL(5, 8);
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const STATUS_CLASS: Record<TerminalLiveStatus, string> = {
  online: "border-success/40 bg-success/10 text-success",
  stale: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  offline: "border-border bg-muted text-muted-foreground",
  revoked: "border-destructive/40 bg-destructive/10 text-destructive",
  "not-activated": "border-primary/40 bg-primary/10 text-primary",
};

/** One badge, one meaning of online / not responding / offline. */
function TerminalStatusBadge({ token, now }: { token: TerminalToken; now: number }) {
  const live = terminalStatus(token, now);
  return (
    <Badge variant="outline" className={STATUS_CLASS[live]} title={TERMINAL_STATUS_HINT[live]}>
      {TERMINAL_STATUS_LABEL[live]}
    </Badge>
  );
}

export function TerminalTokens({
  only,
}: {
  /** Restrict the panel to desktop tills or to phones/tablets. */
  only?: "pc" | "mobile";
} = {}) {
  const { stores } = usePos();
  const [tokens, setTokens] = useState<TerminalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshPendingRef = useRef(false);
  const [error, setError] = useState("");
  const [locationId, setLocationId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [code, setCode] = useState("");
  const [codeTokenId, setCodeTokenId] = useState("");
  const [codeIssuedAt, setCodeIssuedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [claimed, setClaimed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<TerminalToken | null>(null);
  const [pendingReissue, setPendingReissue] = useState<TerminalToken | null>(null);
  const [reissuing, setReissuing] = useState("");
  const [reissued, setReissued] = useState<{ token: TerminalToken; code: string } | null>(null);
  const [reissueCopied, setReissueCopied] = useState(false);
  const [pairScan, setPairScan] = useState(false);
  const [pairTokenId, setPairTokenId] = useState("");
  /** This device's own token — never offer to revoke the terminal you are on. */
  const selfTokenId = useMemo(() => readTerminalConfig()?.tokenId ?? "", []);

  const refresh = useCallback(async () => {
    if (refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    setLoading(true);
    try {
      setTokens(await listTerminalTokens());
      setError("");
    } catch (e) {
      setError(
        (e as { message?: string })?.message ??
          "Could not load terminal tokens. Has supabase/schema.sql been applied?",
      );
    } finally {
      refreshPendingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!locationId && stores.length) setLocationId(stores[0].id);
  }, [stores, locationId]);

  const qr = useMemo(() => (code ? qrDataUrl(code) : ""), [code]);

  // Live 15-minute countdown for the freshly issued code.
  const msLeft = codeIssuedAt ? Math.max(0, codeIssuedAt + ACTIVATION_TTL_MS - now) : 0;
  const expired = Boolean(code) && !claimed && msLeft <= 0;
  const countdown = `${Math.floor(msLeft / 60000)}:${String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0")}`;

  useEffect(() => {
    if (!code || claimed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code, claimed]);

  // Keep online / offline honest without anyone pressing Refresh.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const reload = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(reload);
    };
  }, [refresh]);

  // Watch the issued token until a till redeems it, then celebrate and reload.
  useEffect(() => {
    if (!codeTokenId || claimed || expired) return;
    let stopped = false;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const remote = await fetchTokenStatus(codeTokenId);
        if (!remote || stopped) return;
        if (remote.isClaimed || remote.status === "used") {
          setClaimed(true);
          toast.success("Terminal Activated Successfully!");
          await refresh();
        }
      } catch {
        /* transient — the next tick tries again */
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void check(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [codeTokenId, claimed, expired, refresh]);
  const reissueQr = useMemo(() => (reissued ? qrDataUrl(reissued.code) : ""), [reissued]);
  const locationName = useMemo(() => {
    const s = stores.find((x) => x.id === locationId);
    return s ? `${s.name} — ${s.code}` : "";
  }, [stores, locationId]);

  const generate = async () => {
    if (!locationId) return toast.error("Choose a location first");
    if (!deviceName.trim()) return toast.error("Enter a terminal / device name");
    const store = stores.find((x) => x.id === locationId);
    if (!store) return toast.error("That location is no longer available");
    setIssuing(true);
    try {
      const { code: issued, token } = await issueTerminalToken({
        location: {
          id: store.id,
          code: store.code,
          name: store.name,
          address: store.address,
          phone: store.phone,
        },
        locationName,
        deviceName: deviceName.trim(),
        platform: only ?? "pc",
        ...(pairTokenId ? { tokenId: pairTokenId } : {}),
      });
      setCode(issued);
      setCodeTokenId(token.id);
      setCodeIssuedAt(Date.now());
      setNow(Date.now());
      setClaimed(false);
      setDeviceName("");
      setPairTokenId("");
      logger.log("settings_change", "Terminal token issued", "terminals", {
        location: locationName,
        device: deviceName.trim(),
      });
      toast.success("Activation token generated");
      await refresh();
    } catch (e) {
      toast.error("Could not generate the token", {
        description: describeError(e, "Terminal registration"),
      });
    } finally {
      setIssuing(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const revoke = async (token: TerminalToken) => {
    try {
      await revokeTerminalToken(token.id);
      logger.log("settings_change", "Terminal token revoked", "terminals", {
        device: token.deviceName,
        location: token.locationName,
      });
      toast.success(`${token.deviceName} disconnected`);
      await refresh();
    } catch (e) {
      toast.error("Could not revoke the token", {
        description: describeError(e, "Revoking the terminal"),
      });
    }
  };

  const reissue = async (token: TerminalToken) => {
    setReissuing(token.id);
    try {
      const result = await reissueTerminalToken(token);
      setReissued(result);
      setReissueCopied(false);
      logger.log("settings_change", "Terminal token re-issued", "terminals", {
        device: token.deviceName,
        location: token.locationName,
      });
      toast.success(`New code issued for ${token.deviceName}`);
      await refresh();
    } catch (e) {
      toast.error("Could not re-issue the code", {
        description: describeError(e, "Re-registering the terminal"),
      });
    } finally {
      setReissuing("");
    }
  };

  const copyReissued = async () => {
    if (!reissued) return;
    await navigator.clipboard.writeText(reissued.code);
    setReissueCopied(true);
    window.setTimeout(() => setReissueCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------ generator ----------------------- */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Register a new terminal</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {only === "mobile"
            ? "Issue one code for each Android phone or tablet. Open the POS app on that device and scan or paste the code to assign it to this location."
            : "Issue one code for each Windows counter PC. Open the POS app on that PC and scan or paste the code to assign it to this location."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          This registers the device, not a person. Supervisors and administrators issue codes;
          each staff member signs in with their own account and permissions.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Location / warehouse</Label>
            <ThemedSelect
              ariaLabel="Location or warehouse"
              value={locationId}
              onChange={setLocationId}
              placeholder="Choose a location"
              options={stores.map((s) => ({ value: s.id, label: `${s.name} — ${s.code}` }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="device-name" className="text-[11px] text-muted-foreground">
              {only === "mobile" ? "Phone or tablet name" : "Windows PC name"}
            </Label>
            <Input
              id="device-name"
              className="h-9"
              placeholder={only === "mobile" ? "Sales Tablet 1" : "Billing Counter 1"}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </div>
          <Button
            className="h-9"
            disabled={issuing || !locationId || !deviceName.trim()}
            onClick={() => void generate()}
          >
            {issuing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            Generate activation token
          </Button>
        </div>

        {only !== "mobile" && <div className="mt-4 rounded-lg border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">Pair a PC by scanning its screen</p>
              <p className="text-[11px] text-muted-foreground">
                {pairTokenId
                  ? `Pairing request ${pairTokenId.slice(0, 8)}… ready — approve it with Generate activation token.`
                  : "Point the camera at the pairing QR shown on the PC activation screen."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setPairScan((v) => !v)}
            >
              <Camera className="size-3.5" /> {pairScan ? "Stop camera" : "Scan PC screen"}
            </Button>
          </div>
          {pairScan && (
            <div className="mt-3">
              <CameraScanner
                onScan={(value) => {
                  const request = decodePairingRequest(value);
                  if (!request) {
                    toast.error("That is not a terminal pairing code");
                    return;
                  }
                  setPairTokenId(request.tokenId);
                  setDeviceName((current) => current || request.deviceName);
                  setPairScan(false);
                  toast.success("Pairing request captured — choose the location and approve");
                }}
                onClose={() => setPairScan(false)}
              />
            </div>
          )}
        </div>}

        {code && claimed && (
          <div className="mt-5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Terminal Activated Successfully!
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The code was redeemed and can never be used again. The list below is up to date.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-8 text-xs"
              onClick={() => {
                setCode("");
                setCodeTokenId("");
                setClaimed(false);
              }}
            >
              Done
            </Button>
          </div>
        )}

        {code && !claimed && (
          <div className="mt-5 grid gap-4 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <img
              src={qr}
              alt="Activation code QR"
              className={`mx-auto size-40 rounded-md bg-white p-2 ${expired ? "opacity-30" : ""}`}
            />
            <div className="min-w-0 space-y-2">
              {expired ? (
                <p className="text-xs font-medium text-destructive">
                  This code has expired. Generate a new one to activate the till.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Scan this on the till, or copy the encrypted token below. It can be redeemed
                    once, by one machine.
                  </p>
                  <p className="text-xs font-medium">
                    Expires in <span className="tabular-nums">{countdown}</span>
                  </p>
                </>
              )}
              <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap">
                {code}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={expired}
                onClick={() => void copy()}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy Encrypted Token"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------- tokens -------------------------- */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Registered terminals</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void refresh()}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}{" "}
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}

        {reissued && (
          <div className="m-5 grid gap-4 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <img
              src={reissueQr}
              alt="Replacement activation code QR"
              className="mx-auto size-40 rounded-md bg-white p-2"
            />
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-muted-foreground">
                Replacement code for <strong>{reissued.token.deviceName}</strong> at{" "}
                {reissued.token.locationName || "this location"}. The previous code no longer works.
              </p>
              <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap">
                {reissued.code}
              </pre>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void copyReissued()}
                >
                  {reissueCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {reissueCopied ? "Copied" : "Copy activation code"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setReissued(null)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading terminals…
          </div>
        ) : tokens.filter((t) => (only ? t.platform === only : true)).length === 0 && !error ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            {only === "mobile"
              ? "No phones or tablets registered yet."
              : "No terminals registered yet."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device name</TableHead>
                <TableHead>Location / warehouse</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Activated</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens
                .filter((t) => t.id !== selfTokenId)
                .filter((t) => (only ? t.platform === only : true))
                .map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      {t.deviceName}
                      <span
                        title={t.id}
                        className="block font-mono text-[11px] font-normal text-muted-foreground"
                      >
                        ID {t.id.slice(0, 8)}
                      </span>
                      {t.claimedByDevice && (
                        <span className="block max-w-[14rem] truncate text-xs font-normal text-muted-foreground">
                          {t.claimedByDevice}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.locationName || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.platform === "mobile" ? "Phone / tablet" : "Windows till"}
                    </TableCell>
                    <TableCell>
                      <TerminalStatusBadge token={t} now={now} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {t.appVersion ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.lastSeenAt ? (
                        <>
                          {sinceWords(t.lastSeenAt, now)}
                          <span className="block">{formatDate(t.lastSeenAt)}</span>
                        </>
                      ) : (
                        "Never"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.lastSyncAt ? sinceWords(t.lastSyncAt, now) : "Never"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(t.activatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          disabled={reissuing === t.id || Boolean(t.replacedBy)}
                          onClick={() => setPendingReissue(t)}
                        >
                          {reissuing === t.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          Re-issue code
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => setPendingRevoke(t)}
                        >
                          <ShieldX className="size-3.5" /> Revoke authenticity
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </section>

      <AlertDialog open={!!pendingRevoke} onOpenChange={(o) => !o && setPendingRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to disconnect this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRevoke?.deviceName} at {pendingRevoke?.locationName || "this location"} will
              be locked the next time it reaches the internet, and its cloud sync stops immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const token = pendingRevoke;
                setPendingRevoke(null);
                if (token) void revoke(token);
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingReissue} onOpenChange={(o) => !o && setPendingReissue(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Issue a replacement code for this terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReissue?.deviceName} at {pendingReissue?.locationName || "this location"}{" "}
              keeps its place in this list. The current code stops working immediately and the till
              must be activated again with the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const token = pendingReissue;
                setPendingReissue(null);
                if (token) void reissue(token);
              }}
            >
              Re-issue code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
