import { sameBranchId } from "@/lib/branch-id";
/**
 * Raise a stock request as a full transaction screen rather than a dialog.
 * The request itself never moves stock: it is the paperwork the supplying
 * branch approves, and approval raises the transfer that does the moving.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { TransferComposer } from "@/platforms/web/components/pos/TransferComposer";
import { WorkspaceHeader } from "@/platforms/web/components/pos/TransferWorkspace";
import { usePos } from "@/lib/pos-store";

export const Route = createFileRoute("/requests/new")({
  head: () => ({
    meta: [
      { title: "New stock request — Retail" },
      {
        name: "description",
        content:
          "Ask another branch for stock: search the catalogue, set quantities and send the request for approval.",
      },
      { property: "og:title", content: "New stock request — Retail" },
      {
        property: "og:description",
        content: "Raise a branch-to-branch stock request from a full transaction screen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    items: typeof search.items === "string" ? search.items : undefined,
    draft: typeof search.draft === "string" ? search.draft : undefined,
  }),
  component: NewRequest,
});

function NewRequest() {
  const { state, currentStore, activeShift, createTransfer } = usePos();
  const navigate = useNavigate();
  const { items: prefill, draft: draftId } = Route.useSearch();
  const draft = state.transfers.find(
    (row) =>
      row.id === draftId &&
      row.kind === "request" &&
      row.status === "draft" &&
      sameBranchId(row.toStoreId, currentStore.id),
  );

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <WorkspaceHeader
          back="/transfers"
          backLabel="Back to stock movements"
          title="New stock request"
          subtitle={
            <>
              Ask another branch to send product to{" "}
              <span className="text-primary">{currentStore.name}</span>. Nothing moves until they
              approve and dispatch it.
            </>
          }
        />
        <TransferComposer
          key={draft?.id ?? "new-request"}
          initialProductIds={prefill ? prefill.split(",").filter(Boolean) : undefined}
          initialDraft={draft}
          kind="request"
          submitLabel="Send request"
          onSaveDraft={async ({ otherStoreId, items, note }) => {
            const saved = await createTransfer({
              kind: "request",
              fromStoreId: otherStoreId,
              toStoreId: currentStore.id,
              items,
              note,
              createdBy: activeShift?.cashier ?? "Manager",
              draftId: draft?.id,
              saveAsDraft: true,
              needsApproval: true,
            });
            toast.success(`${saved.ref} saved as draft`);
            void navigate({
              to: "/requests/new",
              search: { items: undefined, draft: saved.id },
              replace: true,
            });
          }}
          onSubmit={async ({ otherStoreId, items, note }) => {
            const t = await createTransfer({
              kind: "request",
              fromStoreId: otherStoreId,
              toStoreId: currentStore.id,
              items,
              note,
              createdBy: activeShift?.cashier ?? "Manager",
              needsApproval: true,
              draftId: draft?.id,
            });
            toast.success(`${t.ref} sent for approval`);
            void navigate({ to: "/requests/$id", params: { id: t.id } });
          }}
        />
      </div>
    </AppShell>
  );
}
