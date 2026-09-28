import { z } from "zod";

const bodySchema = z.object({
  action: z.enum(["save", "set_active", "migrate", "update", "delete"]),
  data: z.record(z.string(), z.unknown()),
});

/** Hosted dispatcher for privileged staff and Supabase Auth mutations. */
export async function handleStaffAdminRequest(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024) {
      return Response.json({ ok: false, error: "Staff request is too large" }, { status: 413 });
    }
    const body = bodySchema.parse(JSON.parse(raw));
    const functions = await import("./staff-admin.functions");
    const result =
      body.action === "save"
        ? await functions.saveStaffAccount({ data: body.data as never })
        : body.action === "set_active"
          ? await functions.setStaffAccountActive({ data: body.data as never })
          : body.action === "migrate"
            ? await functions.migrateCashiersToAccounts({ data: body.data as never })
            : body.action === "update"
              ? await functions.updateStaffAccount({ data: body.data as never })
              : await functions.deleteStaffAccount({ data: body.data as never });
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
