import { useEffect, useState } from "react";
import { GlobalRestrictionPanel } from "./GlobalRestrictionPanel";
import { TableColumnRulesPanel } from "./TableColumnRulesPanel";
import { getRolesWithPermissions, type RoleDef } from "@/lib/role-admin";
import { notifyError } from "@/lib/notify";

export function GlobalPermissionPolicies() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  useEffect(() => {
    let active = true;
    void getRolesWithPermissions().then(rows => { if (active) setRoles(rows); })
      .catch(error => { if (active) notifyError(error, "Role defaults could not be loaded"); });
    return () => { active = false; };
  }, []);
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Company-wide restrictions apply above each person's permissions. User display choices are managed inside Edit permissions.</p><GlobalRestrictionPanel /><TableColumnRulesPanel roles={roles} /></div>;
}
