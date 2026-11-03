import { enrollShiftAuthor, ShiftAuthorError } from "@/lib/shift-author-verification.server";

async function readEnrollment(request: Request): Promise<unknown> {
  const oversized = () => { throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "Request is too large.", 413); };
  if (Number(request.headers.get("content-length") ?? 0) > 12_000) return oversized();
  const reader = request.body?.getReader();
  if (!reader) throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "Invalid author enrollment request.", 400);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, raw = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 12_000) { await reader.cancel(); return oversized(); }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    try { return JSON.parse(raw); } catch { throw new ShiftAuthorError("ESHIFT_AUTHOR_INVALID", "Invalid author enrollment request.", 400); }
  } finally { reader.releaseLock(); }
}

export async function handleShiftAuthorEnroll(request: Request): Promise<Response> {
  try { return Response.json(await enrollShiftAuthor(await readEnrollment(request))); }
  catch (error) {
    if (error instanceof ShiftAuthorError)
      return Response.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    const unavailable = status === 503;
    return Response.json({ ok: false, code: unavailable ? "ESHIFT_AUTHOR_UNAVAILABLE" : "ESHIFT_AUTHOR_INVALID",
      error: unavailable ? "Author verification is temporarily unavailable. The protected work remains pending." : "The protected shift author could not be verified." }, { status: unavailable ? 503 : 403 });
  }
}
