import {
  approvalScopeConfigured,
  approvalSelectedBranch,
  withApprovalScope,
} from "@/lib/approval-branch-scope";
import type { StaffPermissions } from "@/lib/permissions";

export function ApprovalBranchPermissions({
  permissions,
  onChange,
  stores,
  assignedBranch,
  disabled,
}: {
  permissions: StaffPermissions;
  onChange: (value: StaffPermissions) => void;
  stores: { id: string; name: string }[];
  assignedBranch: string | null;
  disabled: boolean;
}) {
  const selected = approvalSelectedBranch(permissions);
  const mode = !approvalScopeConfigured(permissions)
    ? "assigned"
    : permissions["approval_scope:all"]
      ? "all"
      : "selected";
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Approval branch access">
      <label className="grid gap-2 text-sm">
        Receive approvals from
        <select
          className="h-10 rounded-md border bg-background px-3"
          aria-label="Approval branch access"
          disabled={disabled}
          value={mode}
          onChange={(event) =>
            onChange(
              withApprovalScope(
                permissions,
                event.target.value as "assigned" | "all" | "selected",
                selected || stores[0]?.id,
              ),
            )
          }
        >
          <option value="assigned">Assigned branch / explicitly routed requests</option>
          <option value="selected" disabled={!!assignedBranch}>A particular branch</option>
          <option value="all" disabled={!!assignedBranch}>All branches</option>
        </select>
      </label>
      {mode === "selected" && (
        <label className="grid gap-2 text-sm">
          Branch
          <select
            className="h-10 rounded-md border bg-background px-3"
            aria-label="Approval branch"
            disabled={disabled || !!assignedBranch}
            value={selected}
            onChange={(event) =>
              onChange(withApprovalScope(permissions, "selected", event.target.value))
            }
          >
            <option value="" disabled>
              Select a branch
            </option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {assignedBranch && mode !== "assigned" ? "A saved approval scope is still present. Choose Assigned branch to reset it when moving this account. " : ""}
        {assignedBranch ? "This account remains restricted to its assigned branch. " : ""}This
        chooses the approval queue's branch scope. Approver rules, routing, action permissions and
        limits still apply. Registered tills remain pinned to their branch.
      </p>
    </section>
  );
}
