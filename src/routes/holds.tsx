/**
 * Hold tickets — every parked draft in one place.
 *
 * Cashiers can look inside a held ticket, reopen it on the register (the open
 * ticket is parked automatically so nothing is lost when switching), or
 * discard it. Every clear, void, hold, reopen and reprint is written to the
 * ticket trail shown at the bottom of the page.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PauseCircle, PlayCircle, ShieldCheck, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { removeHeldOrder, useHeldOrders, type HeldOrder } from "@/lib/held-orders";
import { TICKET_ACTIONS, logTicketEvent, useTicketTrail } from "@/lib/ticket-audit";
import { loadApprovalCentre, subscribeApprovals } from "@/lib/approval-centre";
import type { AuthorizationRequest } from "@/lib/authorization";
import { cancelAuthorizationRequest } from "@/lib/authorization-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";

export const Route = createFileRoute("/holds")({
  head: () => ({
    meta: [
      { title: "Hold Tickets — Retail" },
      {
        name: "description",
        content:
          "View, reopen and switch between parked tickets, and see who cleared, voided, held or reprinted each one.",
      },
      { property: "og:title", content: "Hold Tickets — Retail" },
      {
        property: "og:description",
        content: "Parked drafts and the full ticket trail for your till.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HoldTickets,
});

const when = (iso: string) => new Date(iso).toLocaleString();

function heldFor(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function HoldTickets() {
  const { currentStore } = usePos();
  const { user, can } = useAuth();
  const { requirePermission } = useUserPermissions();
  const navigate = useNavigate();
  const held = useHeldOrders(currentStore.id);
  const trail = useTicketTrail();
  const [openId, setOpenId] = useState<string | null>(null);
  const [approvalRequests, setApprovalRequests] = useState<AuthorizationRequest[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const centre = await loadApprovalCentre(currentStore.id);
      if (active) {
        setApprovalRequests([
          ...centre.toDecide,
          ...centre.waiting,
          ...centre.ready,
          ...centre.history,
        ]);
      }
    };
    void refresh();
    const unsubscribe = subscribeApprovals(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [currentStore.id]);

  const approvalById = useMemo(
    () => new Map(approvalRequests.map((request) => [request.id, request])),
    [approvalRequests],
  );

  const tickets = held.filter((h) => !h.storeId || h.storeId === currentStore.id);

  function reopen(order: HeldOrder) {
    if (!can("can_reopen_held_order")) {
      toast.error("Reopen held ticket permission is required");
      return;
    }
    void navigate({ to: "/", search: { resume: order.id } });
  }

  async function discard(order: HeldOrder) {
    if (!(await requirePermission("can_discard_held_order"))) return;
    if (order.pendingRequestId) {
      const cancelled = await cancelAuthorizationRequest({
        data: {
          ...(await getPosCallerAuth()),
          id: order.pendingRequestId,
          reason: "Held bill discarded before completion",
        },
      }).catch(() => null);
      if (!cancelled?.ok) {
        toast.error(
          (cancelled && "error" in cancelled ? cancelled.error : "") ||
            "Could not void the bill's approval; the held bill was kept",
        );
        return;
      }
    }
    try {
      await removeHeldOrder(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The held ticket could not be removed");
      return;
    }
    logTicketEvent(TICKET_ACTIONS.discarded, {
      holdRef: order.id,
      lines: order.lines.length,
      value: order.total,
      heldAt: order.heldAt,
      heldBy: order.heldBy ?? null,
      storeId: currentStore.id,
    });
    toast.success("Held ticket discarded");
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Hold tickets</h1>
            <p className="text-sm text-muted-foreground">
              {tickets.length} parked ticket{tickets.length === 1 ? "" : "s"} at {currentStore.name}{" "}
              · signed in as {user?.name}
            </p>
          </div>
          <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
            Back to register
          </Button>
        </header>

        <section className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Held by</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((h) => (
                <Fragment key={h.id}>
                  <TableRow>
                    <TableCell>
                      <button
                        className="text-left hover:text-primary"
                        onClick={() => setOpenId(openId === h.id ? null : h.id)}
                      >
                        <span className="block font-medium">{h.label}</span>
                        <span className="numeric block text-[11px] text-muted-foreground">
                          {when(h.heldAt)}
                        </span>
                      </button>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.cancelledFrom && (
                          <Badge variant="outline">Cancelled {h.cancelledFrom}</Badge>
                        )}
                        {h.memberName && (
                          <Badge variant="secondary">
                            <User className="mr-1 size-3" />
                            {h.memberName}
                          </Badge>
                        )}
                        {h.pendingRequestId && (
                          <Badge
                            variant={
                              approvalById.get(h.pendingRequestId)?.status === "approved"
                                ? "default"
                                : "outline"
                            }
                          >
                            <ShieldCheck className="mr-1 size-3" />
                            {approvalById.get(h.pendingRequestId)?.status === "approved"
                              ? approvalById.get(h.pendingRequestId)?.consumedAt
                                ? "Approval applied"
                                : "Approved — ready"
                              : approvalById.get(h.pendingRequestId)?.status === "rejected"
                                ? "Approval rejected"
                                : approvalById.get(h.pendingRequestId)?.status === "expired"
                                  ? "Approval expired"
                                  : h.status === "ready"
                                    ? "Decision ready"
                                    : "Waiting approval"}
                            {` · #${h.pendingRequestId.slice(-8).toUpperCase()}`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{h.heldBy ?? "—"}</TableCell>
                    <TableCell className="numeric text-sm">{heldFor(h.heldAt)}</TableCell>
                    <TableCell className="numeric text-right">{h.lines.length}</TableCell>
                    <TableCell className="numeric text-right font-semibold">
                      {money(h.total)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={!can("can_reopen_held_order")}
                          onClick={() => reopen(h)}
                        >
                          <PlayCircle className="size-4" /> Reopen
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={!can("can_discard_held_order")}
                          onClick={() => void discard(h)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {openId === h.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-surface-2">
                        <ul className="space-y-1 text-sm">
                          {h.lines.map((l, i) => (
                            <li key={`${l.productId}-${i}`} className="flex justify-between">
                              <span className="truncate">
                                {l.qty} × {l.name}
                              </span>
                              <span className="numeric">{money(l.price * l.qty)}</span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {tickets.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    <PauseCircle className="mx-auto mb-2 size-5" />
                    No tickets on hold. Park one from the register with “Hold order”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Ticket trail
          </h2>
          {trail.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ticket activity recorded yet on this terminal.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {trail.slice(0, 60).map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="text-sm">
                    <span className="font-medium">{e.action}</span>{" "}
                    <span className="text-muted-foreground">
                      by {e.staffName}
                      {e.role ? ` (${e.role})` : ""}
                      {typeof e.details?.["lines"] === "number"
                        ? ` · ${String(e.details["lines"])} item(s)`
                        : ""}
                      {typeof e.details?.["receiptNo"] === "string"
                        ? ` · ${String(e.details["receiptNo"])}`
                        : ""}
                    </span>
                  </span>
                  <span className="numeric text-[11px] text-muted-foreground">{when(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
