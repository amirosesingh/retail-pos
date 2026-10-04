import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/pos/ipc-adopt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const length = Number(request.headers.get("content-length") ?? 0);
        if (length > 10_000)
          return Response.json({ ok: false, error: "Request is too large." }, { status: 413 });
        const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const proof = {
          accessToken: typeof input?.accessToken === "string" ? input.accessToken : undefined,
          sessionToken: typeof input?.sessionToken === "string" ? input.sessionToken : undefined,
          cashierToken: typeof input?.cashierToken === "string" ? input.cashierToken : undefined,
          terminalToken: typeof input?.terminalToken === "string" ? input.terminalToken : undefined,
        };
        if (
          (proof.accessToken?.length ?? 0) > 4000 ||
          (proof.sessionToken?.length ?? 0) > 400 ||
          (proof.cashierToken?.length ?? 0) > 2000 ||
          (proof.terminalToken?.length ?? 0) > 2000
        )
          return Response.json(
            { ok: false, error: "A valid sign-in is required." },
            { status: 401 },
          );
        if (!proof.accessToken && !proof.sessionToken && !proof.cashierToken)
          return Response.json(
            { ok: false, error: "A valid sign-in is required." },
            { status: 401 },
          );
        const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
        const { databaseAuthority } = await import("@/lib/desktop-database-authority.server");
        try {
          const caller = await verifyRelayCaller(proof);
          const authority = await databaseAuthority({
            userId: caller.staffUserId,
            authUserId: caller.authUserId,
            email: caller.email,
          });
          // Session adoption establishes the signed-in person's complete,
          // server-verified POS permission set.  It must not require the
          // unrelated database-maintenance permission: an ordinary cashier
          // still needs the desktop process to authorize sale aggregates.
          // Database and sync channels independently require
          // can_manage_sync_backup in electron/ipc-privilege.cjs.
          if (!authority) {
            return Response.json(
              { ok: false, error: "This staff account is not active." },
              { status: 403 },
            );
          }
          return Response.json({
            ok: true,
            ...authority,
            // A cashier session or terminal token may carry the verified
            // branch even when a global administrator has no store_id.
            branchId: authority.branchId ?? caller.storeId ?? null,
          });
        } catch {
          return Response.json(
            { ok: false, error: "Your sign-in could not be verified." },
            { status: 401 },
          );
        }
      },
    },
  },
});
