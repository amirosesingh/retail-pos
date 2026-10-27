import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/pos/ipc-authorize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > 4096) return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
        const input = (await request.json().catch(() => null)) as
          | { username?: unknown; pin?: unknown; terminalId?: unknown; branchId?: unknown; deviceBindingProof?:unknown }
          | null;
        const username = typeof input?.username === "string" ? input.username.trim() : "";
        const pin = typeof input?.pin === "string" ? input.pin : "";
        if (!username || pin.length < 4 || pin.length > 32) {
          return Response.json({ ok: false, error: "Enter a valid username and PIN." }, { status: 400 });
        }
        const { cashierLoginServer } = await import("@/lib/cashier-login.server");
        const result = await cashierLoginServer({
          username,
          pin,
          request,
          platform: "windows-ipc-authorization",
          deviceBindingProof: typeof input?.deviceBindingProof === "string" ? input.deviceBindingProof : undefined,
          terminalId: typeof input?.terminalId === "string" ? input.terminalId : null,
          branchId: typeof input?.branchId === "string" ? input.branchId : null,
        });
        if (!result.ok) return Response.json(result, {
          status: result.code === "locked" ? 429 : result.code === "central_unavailable" ? 503 : 401,
        });
        const { databaseAuthority } = await import("@/lib/desktop-database-authority.server");
        const authority = await databaseAuthority({ userId: result.cashier.username });
        if (!authority?.permissions.can_manage_sync_backup)
          return Response.json({ ok: false, error: "Manage database connection permission is required." }, { status: 403 });
        return Response.json({ ok: true, ...authority });
      },
    },
  },
});
