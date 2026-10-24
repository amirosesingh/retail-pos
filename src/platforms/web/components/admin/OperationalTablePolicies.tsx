import { useEffect, useState } from "react";
import { TableColumnRulesPanel } from "./TableColumnRulesPanel";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import { notifyError } from "@/lib/notify";

export function OperationalTablePolicies() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  useEffect(() => {
    let active = true;
    void getRolesWithPermissions().then(rows => { if (active) setRoles(rows); })
      .catch(error => { if (active) notifyError(error, "Role defaults could not be loaded"); });
    return () => { active = false; };
  }, []);
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Set company-wide table column visibility here. Individual display choices remain in Edit permissions.</p><TableColumnRulesPanel roles={roles} /></div>;
}
