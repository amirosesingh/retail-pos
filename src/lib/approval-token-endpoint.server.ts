import { z } from "zod";
import {
  enrollApprovalToken,
  manageApprovalMethods,
  approvalVerifierBundle,
  registerApprovalVerifier,
} from "./approval-token-server";
const schema = z.object({
  action: z.enum(["enroll", "methods", "bundle", "register_verifier"]),
  data: z.object({
    sessionToken: z.string().max(400).optional(),
    cashierToken: z.string().max(2000).optional(),
    accessToken: z.string().max(4000).optional(),
    terminalToken: z.string().uuid().optional(),
    publicKey: z.string().min(300).max(6000).optional(),
    userId: z.string().min(1).max(160).optional(),
    pinEnabled: z.boolean().optional(),
    totpEnabled: z.boolean().optional(),
  }),
});
export async function handleApprovalCredentials(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 10_000) throw new Error("Request too large");
    const { action, data } = schema.parse(JSON.parse(text));
    const result =
      action === "enroll"
        ? await enrollApprovalToken(data)
        : action === "register_verifier"
          ? await registerApprovalVerifier(data, z.string().parse(data.publicKey))
          : action === "bundle"
            ? await approvalVerifierBundle(data.terminalToken || "")
            : await manageApprovalMethods(
                data,
                z.string().parse(data.userId),
                z.boolean().parse(data.pinEnabled),
                z.boolean().parse(data.totpEnabled),
              );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Approval credential request failed",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
