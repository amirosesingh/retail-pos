// Shared by the renderer and native upload worker. A local/client activity
// record is evidence of a report, not proof that the central shift is closed.
export const SHIFT_CLOSURE_UNCONFIRMED_NOTICE = "Central closure has not been confirmed by this notification.";

export function shiftClosureMessageWithoutStatus(message) {
  const text = typeof message === "string" ? message.trim() : "";
  return text.endsWith(SHIFT_CLOSURE_UNCONFIRMED_NOTICE)
    ? text.slice(0, -SHIFT_CLOSURE_UNCONFIRMED_NOTICE.length).trim()
    : text;
}

export function shiftClosureStatusMessage(message, notice) {
  const original = shiftClosureMessageWithoutStatus(message);
  const annotated = [original, notice].filter(Boolean).join("\n");
  // The direct report endpoint accepts at most 1,000 characters. Keep the
  // original detail intact when it fills that budget; title/meta still state
  // the confirmation status, and the durable report can still be delivered.
  return annotated.length <= 1000 ? annotated : original;
}

function reportMeta(value) {
  let meta = value;
  if (typeof meta === "string") {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  const original = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  return {
    ...Object.fromEntries(Object.entries(original).filter(([key]) => !key.startsWith("shift_closure_"))),
    client_reported: true,
    shift_closure_status: "unconfirmed",
  };
}

export function unconfirmedShiftClosureActivityRow(row) {
  if (row.event_type !== "shift_close") return row;
  return {
    ...row,
    title: "Shift closure reported",
    message: shiftClosureStatusMessage(row.message, SHIFT_CLOSURE_UNCONFIRMED_NOTICE),
    meta: reportMeta(row.meta),
  };
}

export function unconfirmedShiftClosureActivity(input) {
  if (input.type !== "shift_close") return input;
  const row = unconfirmedShiftClosureActivityRow({ ...input, event_type: input.type });
  return { ...input, title: row.title, message: row.message, meta: row.meta };
}
