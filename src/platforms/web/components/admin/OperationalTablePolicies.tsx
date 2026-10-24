import { useEffect, useState } from "react";
import { TableColumnRulesPanel } from "./TableColumnRulesPanel";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import { notifyError } from "@/lib/notify";
import { useAuth } from "@/lib/pos-auth";

export function OperationalTablePolicies() {
  const { isAdmin } = useAuth();
  const [roles, setRoles] = useState<RoleDef[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void getRolesWithPermissions().then(rows => { if (active) setRoles(rows); })
      .catch(error => { if (active) notifyError(error, "Role defaults could not be loaded"); });
    return () => { active = false; };
  }, [isAdmin]);
  if (!isAdmin) return null;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
    <div className="min-w-0"><h3 className="text-sm font-medium">Table column visibility</h3><p className="text-xs text-muted-foreground">Choose visible columns for everyone, a role or one user. Data access still follows their permissions.</p></div>
    <TableColumnRulesPanel roles={roles} />
  </div>;
}
