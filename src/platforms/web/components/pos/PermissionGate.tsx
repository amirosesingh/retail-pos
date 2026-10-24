/**
 * One place that explains a missing permission.
 *
 * Screens and buttons used to fail silently or simply disappear, which reads
 * as a broken till. Everything blocked now names the exact toggle an
 * administrator has to switch on in Staff Management.
 */
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PERMISSION_LABELS, resolvePermission, type PermissionFlag } from "@/lib/permissions";

export const permissionLabel = (flag: PermissionFlag): string =>
  PERMISSION_LABELS[resolvePermission(flag)] ?? String(flag);

export const permissionMessage = (flag: PermissionFlag): string =>
  `You need the “${permissionLabel(flag)}” permission. Ask an administrator to open Staff & Permissions → People & permissions → your account → Edit permissions.`;

/** Toast helper for a blocked button or action. */
export function denyPermission(flag: PermissionFlag) {
  toast.error("Permission required", { description: permissionMessage(flag) });
}

/**
 * Run `action` only when `allowed`; otherwise explain what is missing.
 * Returns true when the action ran.
 */
export function requirePermission(
  allowed: boolean,
  flag: PermissionFlag,
  action?: () => void,
): boolean {
  if (!allowed) {
    denyPermission(flag);
    return false;
  }
  action?.();
  return true;
}

/** Full-screen explanation used by the route guard. */
export function PermissionDenied({
  flag,
  title = "Permission required",
}: {
  flag?: PermissionFlag | null;
  title?: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <Lock className="size-8 text-muted-foreground" />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {flag
          ? permissionMessage(flag)
          : "This screen is restricted to administrators. Ask an administrator to open it for you."}
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to the register</Link>
      </Button>
    </div>
  );
}
