/**
 * Raise a direct transfer — stock this branch is sending to another one with
 * no request behind it. No fake request reference is written: the note simply
 * has no source request.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { TransferComposer } from "@/platforms/web/components/pos/TransferComposer";
import { WorkspaceHeader } from "@/platforms/web/components/pos/TransferWorkspace";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useManagerGate } from "@/lib/manager-gate";
import { verifyBusinessAuthorization } from "@/lib/authorization-client";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";

export const Route = createFileRoute("/transfers/new")({
  head: () => ({
    meta: [
      { title: "New stock transfer — Retail" },
      {
        name: "description",
        content:
          "Send stock to another branch: pick products, set the quantities going in the box and raise the transfer note.",
      },
      { property: "og:title", content: "New stock transfer — Retail" },
      {
        property: "og:description",
        content: "Raise a direct branch-to-branch stock transfer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    items: typeof search.items === "string" ? search.items : undefined,
  }),
  component: NewTransferPage,
});

function NewTransferPage() {
  const { state, currentStore, activeShift, createTransfer } = usePos();
  const navigate = useNavigate();
  const { items: prefill } = Route.useSearch();
  const { user } = useAuth();
  const { authorize, rules: authorizationRules } = useManagerGate();
  const transferMode =
    authorizationRules.stock_transfer?.mode ??
    (state.settings.integrations.requireTransferApproval ? "request" : "none");
  const requireApproval = transferMode === "request" || transferMode === "either";

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <WorkspaceHeader
          back="/transfers"
          backLabel="Back to stock movements"
          title="New stock transfer"
          subtitle={
            <>
              Send product from <span className="text-primary">{currentStore.name}</span> to another
              branch. Stock leaves the shelf when the note is dispatched.
            </>
          }
        />
        <TransferComposer
          initialProductIds={prefill ? prefill.split(",").filter(Boolean) : undefined}
          kind="transfer"
          submitLabel={requireApproval ? "Send for approval" : "Raise transfer"}
          onSubmit={async ({ otherStoreId, items, note }) => {
            const transferKey = [
              currentStore.id,
              otherStoreId,
              ...items.map((item) => `${item.productId}:${item.qty}`).sort(),
            ].join("|");
            const payload = {
              transfer_key: transferKey,
              from_store_id: currentStore.id,
              to_store_id: otherStoreId,
              line_count: items.length,
              total_quantity: items.reduce((sum, item) => sum + item.qty, 0),
            };
            const grant = await authorize({
              action: "stock_transfer",
              title: "Authorise stock transfer",
              reason:
                note.trim() || `Move ${items.reduce((sum, item) => sum + item.qty, 0)} unit(s)`,
              storeId: currentStore.id,
              requestedBy: user?.staffId ?? user?.name ?? null,
              requestedAmount: items.reduce((sum, item) => sum + item.qty, 0),
              valueUnit: "quantity",
              payload,
              detail: note,
            });
            if (!grant.ok) return;
            const verified = await verifyBusinessAuthorization({
              data: {
                ...(await getPosCallerAuth()),
                actionKey: "stock_transfer",
                storeId: currentStore.id,
                payload,
                requestedAmount: items.reduce((sum, item) => sum + item.qty, 0),
                grantToken: grant.grantToken,
              },
            });
            if (!verified.ok) {
              toast.error(verified.error);
              return;
            }
            const t = await createTransfer({
              kind: "transfer",
              fromStoreId: currentStore.id,
              toStoreId: otherStoreId,
              items,
              note,
              createdBy: activeShift?.cashier ?? "Manager",
              needsApproval: false,
            });
            toast.success(
              t.status === "awaiting_approval"
                ? `${t.ref} sent for approval`
                : `${t.ref} raised — dispatch it when the box is packed`,
            );
            void navigate({ to: "/transfers/$id", params: { id: t.id } });
          }}
        />
      </div>
    </AppShell>
  );
}
