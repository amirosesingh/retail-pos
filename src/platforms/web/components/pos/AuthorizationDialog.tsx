import { nativeApprovalCredentials } from "@/platform-config/approval-token";
/**
 * The one prompt shown when an action needs authorising.
 *
 * Depending on the branch rule it offers a PIN (someone with the right to
 * approve is standing there), an approval request (nobody is), or both. The
 * PIN itself is only ever checked inside the database.
 */
import { useEffect, useId, useState } from "react";
import { Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/lib/notify";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { authorizeWithPin, submitAuthorizationRequest } from "@/lib/authorization-client";
import { looksOffline, parkGovernanceRow } from "@/lib/governance-offline";
import { useAuthOptional } from "@/lib/pos-auth";
import type { AuthActionKey, AuthMode, AuthPayload, AuthorizationRule } from "@/lib/authorization";
import {
  APPROVAL_TTL_MS,
  approvalReference,
  canAuthorizeAmount,
} from "@/lib/authorization";
import { verifyLocalApprovalPin } from "@/core/local-db/local-staff";
import { normalizeSnapshot, snapshotFingerprint, type TicketSnapshot } from "@/lib/ticket-snapshot";
import { syncNow } from "@/lib/sync-engine";
import { approvalIdentity } from "@/lib/approval-identity";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
        const value = Math.floor(Math.random() * 16);
        return (token === "x" ? value : (value & 0x3) | 0x8).toString(16);
      });

export type AuthorizationPrompt = {
  actionKey: string;
  mode: Exclude<AuthMode, "none">;
  title: string;
  reason: string;
  requireReason: boolean;
  storeId?: string | null;
  terminalId?: string | null;
  payload?: AuthPayload;
  /** The ticket the approver will review, when the action came from a sale. */
  snapshot?: TicketSnapshot | null;
  requestedAmount?: number | null;
  requesterDirectLimit?: number | null;
  valueUnit?: "percent" | "currency" | "quantity" | "number";
  heldOrderId?: string | null;
  allowedRoles?: string[];
  allowedUserIds?: string[];
  authorityLimits?: Record<string, number>;
  extraAuthority?: Record<string, number>;
  absoluteCeilings?: Record<string, number>;
  approvalTimeoutMinutes?: number;
  binding: string;
  /** Signed-in person who may approve this action with their own PIN. */
  selfAuthorizer?: { id: string; name: string; role: string };
};

export type PromptOutcome =
  | {
      kind: "approved";
      grantToken: string;
      by: string;
      authorizer: { id: string; name: string; role: string };
      offline?: boolean;
    }
  | { kind: "submitted"; requestId: string }
  | { kind: "cancelled" };

export function AuthorizationDialog({
  prompt,
  onFinish,
}: {
  prompt: AuthorizationPrompt | null;
  onFinish: (outcome: PromptOutcome) => void;
}) {
  const fieldId = useId();
  const [tab, setTab] = useState<"pin" | "request">("pin");
  const [authorizerId, setAuthorizerId] = useState("");
  const [tokenOnly, setTokenOnly] = useState(false);
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useAuthOptional();
  const me = session?.user ?? null;

  async function authorizeLocalPin() {
    if (!prompt) return false;
    const identity = approvalIdentity(tokenOnly, authorizerId, prompt.selfAuthorizer?.id);
    const expectedId = identity.authorizerId;
    const result = await verifyLocalApprovalPin(expectedId, pin);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    if (
      identity.selfAuthorization && prompt.selfAuthorizer &&
      result.staff.username.toLowerCase() !== prompt.selfAuthorizer.id.toLowerCase()
    ) {
      toast.error("Enter the PIN for the signed-in account.");
      return false;
    }
    const rule: AuthorizationRule = {
      id: "",
      actionKey: prompt.actionKey as AuthActionKey,
      scopeType: "branch" as const,
      scopeId: prompt.storeId ?? "",
      mode: "pin" as const,
      allowedRoles: prompt.allowedRoles ?? ["admin", "manager"],
      allowedUserIds: prompt.allowedUserIds ?? [],
      requesterRoles: [],
      requesterUserIds: [],
      authorityLimits: prompt.authorityLimits ?? {},
      extraAuthority: prompt.extraAuthority ?? {},
      absoluteCeilings: prompt.absoluteCeilings ?? {},
      approvalTimeoutMinutes: 15,
      escalationAfterMinutes: null,
      escalationRoles: [],
      requireReason: prompt.requireReason,
      threshold: null,
      isEnabled: true,
      rowVersion: 0,
      updatedAt: null,
      updatedBy: null,
    };
    if (
      !canAuthorizeAmount(
        rule,
        { userId: result.staff.username, role: result.staff.roleSlug },
        prompt.requestedAmount,
        prompt.requesterDirectLimit,
      )
    ) {
      toast.error("This locally verified account is not allowed to approve this action.");
      return false;
    }
    const parked = await parkGovernanceRow("authorization_log", {
      id: newId(),
      action_key: prompt.actionKey,
      mode_used: "offline_pin",
      requested_by: me?.staffId ?? null,
      authorized_by: result.staff.username,
      authorizer_role: result.staff.roleSlug,
      store_id: prompt.storeId ?? "",
      terminal_id: prompt.terminalId ?? "",
      outcome: "approved",
      detail: {
        reason: note.trim(),
        offline: true,
        credential_method: result.credentialMethod ?? "pin",
        approved_by_name: result.staff.full_name || result.staff.username,
        requested_by_name: me?.name ?? "",
        ticket_reference: prompt.snapshot?.billNo || prompt.payload?.["bill_no"] || prompt.payload?.["transaction"] || null,
        self_authorization: identity.selfAuthorization,
        requested_amount: prompt.requestedAmount ?? null,
        approval_location: prompt.payload?.["approval_location"] ?? null,
        reference: prompt.payload?.["bill_no"] ?? prompt.payload?.["transaction"] ?? null,
        context: prompt.payload ?? {},
      },
    });
    if (!parked.parked) {
      toast.error("The approval could not be recorded in the local database.");
      return false;
    }
    toast.success(`Approved offline by ${result.staff.full_name || result.staff.username}`);
    onFinish({
      kind: "approved",
      grantToken: "",
      by: result.staff.full_name || result.staff.username,
      authorizer: {
        id: result.staff.username,
        name: result.staff.full_name || result.staff.username,
        role: result.staff.roleSlug,
      },
      offline: true,
    });
    return true;
  }

  /**
   * Queue the approval request on the till instead of centrally. It carries
   * the same id it will have in the cloud, so the approver sees one request,
   * not two, once the line is back.
   */
  async function parkRequest(id: string, message: string) {
    const createdAt = new Date().toISOString();
    const snapshot = prompt?.snapshot ? normalizeSnapshot(prompt.snapshot) : null;
    const parked = await parkGovernanceRow("authorization_requests", {
      id,
      action_key: prompt?.actionKey ?? "",
      requested_by: me?.staffId ?? "till",
      requested_by_name: me?.name ?? "",
      store_id: prompt?.storeId ?? "",
      terminal_id: prompt?.terminalId ?? "",
      reason: note.trim(),
      payload: prompt?.payload ?? {},
      status: "pending",
      requested_amount: prompt?.requestedAmount ?? snapshot?.requestedValue ?? null,
      requester_direct_limit: prompt?.requesterDirectLimit ?? null,
      value_unit: prompt?.valueUnit ?? "number",
      approved_amount: null,
      approved_payload: {},
      bill_snapshot: snapshot ?? {},
      snapshot_hash: snapshotFingerprint(snapshot),
      held_order_id: prompt?.heldOrderId ?? null,
      notified_at: null,
      created_at: createdAt,
      updated_at: createdAt,
      expires_at: new Date(
        Date.now() + (prompt?.approvalTimeoutMinutes ?? APPROVAL_TTL_MS / 60_000) * 60_000,
      ).toISOString(),
    });
    if (!parked.parked) {
      toast.error(message || "Could not send the request");
      return;
    }
    toast.success("Recorded on this till", {
      description: `${approvalReference({ id, terminalId: prompt?.terminalId ?? "", createdAt })} will reach the approvals queue as soon as the line is back.`,
    });
    onFinish({ kind: "submitted", requestId: id });
  }

  useEffect(() => {
    if (!prompt) return;
    setTab(prompt.mode === "request" ? "request" : "pin");
    setAuthorizerId(prompt.selfAuthorizer?.id ?? "");
    setPin("");
    setTokenOnly(nativeApprovalCredentials && !prompt.selfAuthorizer);
    setNote("");
  }, [prompt]);

  async function submitPin() {
    if (!prompt) return;
    setBusy(true);
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await authorizeLocalPin();
        return;
      }
      const auth = await getPosCallerAuth();
      const res = await authorizeWithPin({
        data: {
          ...auth,
          actionKey: prompt.actionKey,
          ...approvalIdentity(tokenOnly, authorizerId, prompt.selfAuthorizer?.id),
          pin,
          binding: prompt.binding,
          auditContext: { ...prompt.payload, ticket_reference: prompt.snapshot?.billNo || prompt.payload?.["bill_no"] || prompt.payload?.["transaction"] || null },
          ...(prompt.storeId ? { storeId: prompt.storeId } : {}),
          ...(prompt.terminalId ? { terminalId: prompt.terminalId } : {}),
          ...(note.trim() ? { reason: note.trim() } : {}),
          ...(prompt.requestedAmount == null ? {} : { requestedAmount: prompt.requestedAmount }),
          ...(prompt.requesterDirectLimit == null
            ? {}
            : { requesterDirectLimit: prompt.requesterDirectLimit }),
        },
      });
      if (!res.ok) {
        if (looksOffline(res.error)) await authorizeLocalPin();
        else toast.error(res.error ?? "Authorisation failed");
        return;
      }
      toast.success(`Approved by ${res.authorizer.name}`);
      onFinish({
        kind: "approved",
        grantToken: res.grantToken,
        by: res.authorizer.name,
        authorizer: res.authorizer,
      });
    } catch (e) {
      if (looksOffline(e)) await authorizeLocalPin();
      else notifyError(e, "Authorisation failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!prompt) return;
    // One id follows the request through the direct cloud attempt, a lost
    // response, and the local offline fallback. Both databases therefore
    // converge on one request and one eventual decision.
    const requestId = newId();
    setBusy(true);
    try {
      const auth = await getPosCallerAuth();
      const res = await submitAuthorizationRequest({
        data: {
          ...auth,
          requestId,
          actionKey: prompt.actionKey,
          reason: note.trim() || prompt.reason,
          payload: prompt.payload ?? {},
          ...(prompt.storeId ? { storeId: prompt.storeId } : {}),
          ...(prompt.terminalId ? { terminalId: prompt.terminalId } : {}),
          ...(prompt.snapshot ? { snapshot: prompt.snapshot } : {}),
          ...(prompt.requestedAmount === undefined || prompt.requestedAmount === null
            ? {}
            : { requestedAmount: prompt.requestedAmount }),
          ...(prompt.requesterDirectLimit == null
            ? {}
            : { requesterDirectLimit: prompt.requesterDirectLimit }),
          valueUnit: prompt.valueUnit ?? "number",
          ...(prompt.heldOrderId ? { heldOrderId: prompt.heldOrderId } : {}),
        },
      });
      if (!res.ok || !res.request) {
        if (looksOffline(res.error)) await parkRequest(requestId, res.error ?? "");
        else toast.error(res.error ?? "Could not send the request");
        return;
      }
      toast.success("Sent for approval", {
        description: `${approvalReference(res.request)} · You can continue once it is approved.`,
      });
      onFinish({ kind: "submitted", requestId: res.request.id });
      // Supabase is authoritative online. Mirroring it to SQL Server is an
      // explicitly background operation and never delays this dialog.
      void syncNow(`approval-request:${res.request.id}`);
    } catch (e) {
      if (looksOffline(e)) {
        await parkRequest(requestId, String((e as Error)?.message ?? e));
      } else notifyError(e, "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  const reasonMissing = prompt?.requireReason && !note.trim();
  const activeMode = prompt?.mode === "either" ? tab : prompt?.mode;

  const pinPane = (
    <div className="grid gap-4 sm:grid-cols-2">
      {nativeApprovalCredentials && <div className="flex gap-2 sm:col-span-2">
        <Button variant={tokenOnly ? "default" : "outline"} size="sm" onClick={() => { setTokenOnly(true); setPin(""); }}>Soft token</Button>
        <Button variant={!tokenOnly ? "default" : "outline"} size="sm" onClick={() => { setTokenOnly(false); setPin(""); }}>Approval PIN</Button>
      </div>}
      {prompt?.selfAuthorizer && !tokenOnly ? (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm sm:col-span-2">
          <div className="font-medium">Confirm as {prompt.selfAuthorizer.name}</div>
          <div className="text-xs text-muted-foreground">
            {nativeApprovalCredentials ? "Enter your own authorization PIN or soft token." : "Enter your own PIN."} This approval will be recorded under your account.
          </div>
        </div>
      ) : !tokenOnly ? (
        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-authorizer`} className="text-sm">Authoriser ID</Label>
          <Input
            id={`${fieldId}-authorizer`}
            name="authorizer-id"
            className="h-11"
            autoComplete="off"
            autoFocus
            value={authorizerId}
            onChange={(e) => setAuthorizerId(e.target.value)}
            placeholder="e.g. manager1"
          />
        </div>
      ) : null}
      <div className={prompt?.selfAuthorizer ? "space-y-1 sm:col-span-2" : "space-y-1"}>
        <Label htmlFor={`${fieldId}-pin`} className="text-sm">{tokenOnly ? "Eight-digit soft token" : nativeApprovalCredentials ? "Authorization PIN or soft token" : "Approval PIN"}</Label>
        <Input
          id={`${fieldId}-pin`}
          name="authorizer-pin"
          autoComplete="one-time-code"
          className="numeric h-11 tracking-[0.2em]"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !reasonMissing) void submitPin();
          }}
        />
      </div>
    </div>
  );

  const requestPane = (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        This will wait in the approvals queue until someone allowed to decide it approves or rejects
        it. Nothing happens to the sale until then.
      </p>
      {prompt?.snapshot ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-4 text-sm">
          <p className="font-medium">
            {prompt.snapshot.lines.length} item(s) · total {prompt.snapshot.total.toFixed(2)}
          </p>
          <p className="text-muted-foreground">
            The whole ticket is sent with the request, and it is parked while you serve the next
            customer. If it changes afterwards the approval no longer applies.
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && onFinish({ kind: "cancelled" })}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle className="flex items-start gap-2 leading-snug">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" /> {prompt?.title ?? "Authorisation"}
          </DialogTitle>
          <DialogDescription>{prompt?.reason}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
        {prompt?.mode === "either" ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "pin" | "request")}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
              <TabsTrigger value="pin" className="min-h-10 min-w-0 whitespace-normal px-2">{nativeApprovalCredentials ? "PIN or soft token" : "Enter a PIN"}</TabsTrigger>
              <TabsTrigger value="request" className="min-h-10 min-w-0 whitespace-normal px-2">Send for approval</TabsTrigger>
            </TabsList>
            <TabsContent value="pin" className="pt-3">
              {pinPane}
            </TabsContent>
            <TabsContent value="request" className="pt-3">
              {requestPane}
            </TabsContent>
          </Tabs>
        ) : prompt?.mode === "request" ? (
          requestPane
        ) : (
          pinPane
        )}

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-reason`} className="text-sm">
            Reason {prompt?.requireReason ? "(required)" : "(optional)"}
          </Label>
          <Textarea
            id={`${fieldId}-reason`}
            className="min-h-24 resize-y"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 400))}
            placeholder="Why is this needed?"
          />
        </div>

        </div>
        <DialogFooter className="shrink-0 border-t border-border/70 bg-muted/15 px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onFinish({ kind: "cancelled" })} disabled={busy}>
            Cancel
          </Button>
          {activeMode === "request" ? (
            <Button onClick={() => void submitRequest()} disabled={busy || !!reasonMissing}>
              <Send className="mr-1 size-4" />
              {busy ? "Sending…" : "Send for approval"}
            </Button>
          ) : (
            <Button
              onClick={() => void submitPin()}
              disabled={busy || (tokenOnly ? pin.length !== 8 : pin.length < 4 || !authorizerId.trim()) || !!reasonMissing}
            >
              {busy ? "Checking…" : "Authorise"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
