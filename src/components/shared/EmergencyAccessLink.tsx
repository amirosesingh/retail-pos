/**
 * The one way into Emergency Access, used by every screen a terminal can get
 * stuck on: the connection gate, the "not configured" prompt and the
 * activation screen.
 *
 * Always router navigation, never `<a href>`: a hard page load restarts the
 * shell, which puts the very gate the operator is escaping straight back in
 * front of the repair screen.
 */
import { Link } from "@tanstack/react-router";
import { LifeBuoy, MoreVertical } from "lucide-react";

import { cn } from "@/lib/utils";
import { isTerminalApp } from "@/platform-config/platform";
import { isMobileShell } from "@/platform-config/features";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function EmergencyAccessLink({
  className,
  label = "Emergency access",
}: {
  className?: string;
  label?: string;
}) {
  if (!isTerminalApp()) return null;
  if (isMobileShell()) return <div className="fixed right-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-50">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="More recovery options"><MoreVertical className="size-5" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link to="/recovery"><LifeBuoy className="mr-2 size-4" />{label}</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
  return (
    <Link
      to="/recovery"
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground",
        className,
      )}
    >
      <LifeBuoy className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
