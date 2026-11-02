import { createFileRoute } from "@tanstack/react-router";

const denied = (status: 401 | 403 = 401) => Response.json(
  { ok: false, code: "EAUTH_DENIED", error: "Your sign-in could not be verified." }, { status },
);

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
          deviceBindingProof:typeof input?.deviceBindingProof==="string" ? input.deviceBindingProof : undefined,
        };
        if (
          (proof.accessToken?.length ?? 0) > 4000 ||
          (proof.sessionToken?.length ?? 0) > 400 ||
          (proof.cashierToken?.length ?? 0) > 2000 ||
          (proof.terminalToken?.length ?? 0) > 2000 ||
          (proof.deviceBindingProof!==undefined && !/^[a-f0-9]{64}$/i.test(proof.deviceBindingProof))
        )
          return denied();
        if (!proof.accessToken && !proof.sessionToken && !proof.cashierToken)
          return denied();
        const { verifyRelayCaller } = await import("@/core/api/pos-relay.server");
        const { databaseAuthority } = await import("@/lib/desktop-database-authority.server");
        try {
          const caller = await verifyRelayCaller(proof, { strictAvailability: true });
          const {resolveRelayScope}=await import("@/core/api/relay-policy.server");
          const scope=await resolveRelayScope(caller, { strictAvailability: true });
          const authority = await databaseAuthority({
            userId: caller.staffUserId,
            authUserId: caller.authUserId,
            email: caller.email,
          }, { strictAvailability: true });
          // Session adoption establishes the signed-in person's complete,
          // server-verified POS permission set.  It must not require the
          // unrelated database-maintenance permission: an ordinary cashier
          // still needs the desktop process to authorize sale aggregates.
          // Database and sync channels independently require
          // can_manage_sync_backup in electron/ipc-privilege.cjs.
          if (!authority) {
            return denied(403);
          }
          return Response.json({
            ok: true,
            ...authority,
            // A cashier session or terminal token may carry the verified
            // branch even when a global administrator has no store_id.
            branchId: scope.storeId,
            accountScope:{branchId:authority.branchId},
            terminal:caller.terminal??null,
          });
        } catch (error) {
          const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
          if (status === 503)
            return Response.json(
              { ok: false, code: "EAUTH_UNAVAILABLE", error: "Sign-in verification is temporarily unavailable. Please try again." },
              { status: 503 },
            );
          return denied(status === 403 ? 403 : 401);
        }
      },
    },
  },
});
