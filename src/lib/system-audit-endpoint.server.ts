import { z } from "zod";

const bodySchema = z.object({
  action: z.enum(["record", "list"]),
  data: z.record(z.string(), z.unknown()),
});

/** Hosted dispatcher for authenticated audit writes and history reads. */
export async function handleSystemAuditRequest(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024) {
      return Response.json({ ok: false, error: "Audit request is too large" }, { status: 413 });
    }
    const body = bodySchema.parse(JSON.parse(raw));
    const functions = await import("./system-audit.functions");
    const result =
      body.action === "record"
        ? await functions.recordSystemAudit({ data: body.data as never })
        : await functions.listSystemAudit({ data: body.data as never });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : "Invalid request",
      },
      { status: 400 },
    );
  }
}
