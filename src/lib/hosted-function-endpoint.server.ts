import { z } from "zod";

// Explicit operations only: no caller-controlled module imports or arbitrary RPCs.
const handlers: Record<string, (data: unknown) => Promise<unknown>> = Object.freeze({
  "notification-rules.loadNotificationRuleTable": async (data) => (await import("./notification-rules.functions")).loadNotificationRuleTable({data: data as never}),
  "notification-rules.saveNotificationRuleTable": async (data) => (await import("./notification-rules.functions")).saveNotificationRuleTable({data: data as never}),
  "notification-rules.processNotificationDeliveries": async (data) => (await import("./notification-rules.functions")).processNotificationDeliveries({data: data as never}),
  "activity-events.pushActivityEvent": async (data) => (await import("./activity-events.functions")).pushActivityEvent({ data: data as never }),
  "activity-events.loadNotificationSettings": async (data) => (await import("./activity-events.functions")).loadNotificationSettings({ data: data as never }),
  "activity-events.saveNotificationSettings": async (data) => (await import("./activity-events.functions")).saveNotificationSettings({ data: data as never }),
  "android-push.updateAndroidPushDevice": async (data) => (await import("./android-push.functions")).updateAndroidPushDevice({ data: data as never }),
  "personal-appearance.loadPersonalAppearance": async (data) => (await import("./personal-appearance.functions")).loadPersonalAppearance({ data: data as never }),
  "personal-appearance.savePersonalAppearance": async (data) => (await import("./personal-appearance.functions")).savePersonalAppearance({ data: data as never }),
  "record-edits.whoAmI": async (data) => (await import("./record-edits.functions")).whoAmI({ data: data as never }),
  "record-edits.holdRecordForEdit": async (data) => (await import("./record-edits.functions")).holdRecordForEdit({ data: data as never }),
  "record-edits.resumeRecordEdit": async (data) => (await import("./record-edits.functions")).resumeRecordEdit({ data: data as never }),
  "record-edits.withdrawRecordEdit": async (data) => (await import("./record-edits.functions")).withdrawRecordEdit({ data: data as never }),
  "record-edits.logRecordEdit": async (data) => (await import("./record-edits.functions")).logRecordEdit({ data: data as never }),
  "record-edits.getRecordEdits": async (data) => (await import("./record-edits.functions")).getRecordEdits({ data: data as never }),
  "record-edits.getRecentRecordEdits": async (data) => (await import("./record-edits.functions")).getRecentRecordEdits({ data: data as never }),
  "status-history.recordStatusHistory": async (data) => (await import("./status-history.functions")).recordStatusHistory({ data: data as never }),
  "status-history.loadStatusHistory": async (data) => (await import("./status-history.functions")).loadStatusHistory({ data: data as never }),
  "user-sessions.startDeviceSession": async (data) => (await import("./user-sessions.functions")).startDeviceSession({ data: data as never }),
  "user-sessions.endDeviceSession": async (data) => (await import("./user-sessions.functions")).endDeviceSession({ data: data as never }),
  "user-sessions.recordDeviceActivity": async (data) => (await import("./user-sessions.functions")).recordDeviceActivity({ data: data as never }),
  "user-sessions.listDeviceSessions": async (data) => (await import("./user-sessions.functions")).listDeviceSessions({ data: data as never }),
  "user-sessions.revokeDeviceSessions": async (data) => (await import("./user-sessions.functions")).revokeDeviceSessions({ data: data as never }),
  "secure-settings.saveSecureSetting": async (data) => (await import("./secure-settings.functions")).saveSecureSetting({ data: data as never }),
  "secure-settings.listSecureSettings": async (data) => (await import("./secure-settings.functions")).listSecureSettings({ data: data as never }),
  "secure-settings.clearSecureSetting": async (data) => (await import("./secure-settings.functions")).clearSecureSetting({ data: data as never }),
  "verification.startMemberVerification": async (data) => (await import("./verification.functions")).startMemberVerification({ data: data as never }),
  "verification.confirmMemberVerification": async (data) => (await import("./verification.functions")).confirmMemberVerification({ data: data as never }),
  "verification.getVerificationSettings": async (data) => (await import("./verification.functions")).getVerificationSettings({ data: data as never }),
  "verification.saveVerificationSettings": async (data) => (await import("./verification.functions")).saveVerificationSettings({ data: data as never }),
  "verification.listMemberVerifications": async (data) => (await import("./verification.functions")).listMemberVerifications({ data: data as never }),
  "shift-corrections.correctClosedShift": async (data) => (await import("./shift-corrections.functions")).correctClosedShift({ data: data as never }),
  "sale-corrections.loadPostedSaleForCorrection": async (data) => (await import("./sale-corrections.functions")).loadPostedSaleForCorrection({ data: data as never }),
  "sale-corrections.correctPostedSale": async (data) => (await import("./sale-corrections.functions")).correctPostedSale({ data: data as never }),
  "tender-correction.correctSaleTender": async (data) => (await import("./tender-correction.functions")).correctSaleTender({ data: data as never }),
  "store-groups.loadStoreGroupsForCaller": async (data) => (await import("./store-groups.functions")).loadStoreGroupsForCaller({ data: data as never }),
  "store-groups.saveStoreGroupForCaller": async (data) => (await import("./store-groups.functions")).saveStoreGroupForCaller({ data: data as never }),
  "stock-ref.reserveCloudStockReference": async (data) => (await import("./stock-ref.functions")).reserveCloudStockReference({ data: data as never }),
  "sku.reserveSkuLease": async (data) => (await import("./sku.functions")).reserveSkuLease({ data: data as never }),
  "shift-summary.publishCompleteShiftSummary": async (data) => (await import("./shift-summary.functions")).publishCompleteShiftSummary({ data: data as never }),
  "shift-alert-settings.saveGlobalShiftAlerts": async (data) => (await import("./shift-alert-settings.functions")).saveGlobalShiftAlerts({ data: data as never }),
  "telemetry.clearTelemetryHistory": async (data) => (await import("./telemetry.functions")).clearTelemetryHistory({ data: data as never }),
  "location-admin.deleteEmptyLocation": async (data) => (await import("./location-admin.functions")).deleteEmptyLocation({ data: data as never }),
  "whatsapp.sendWhatsAppBill": async (data) => (await import("./whatsapp.functions")).sendWhatsAppBill({ data: data as never }),
  "session-permissions.readSessionPermissions": async (data) => (await import("./session-permissions.functions")).readSessionPermissions({ data: data as never }),
  "session-verify.verifySession": async (data) => (await import("./session-verify.functions")).verifySession({ data: data as never }),
  "terminal-account.getTerminalAccount": async (data) => (await import("./terminal-account.functions")).getTerminalAccount({ data: data as never }),
  "pos-rules.getPosRules": async (data) => (await import("./pos-rules.functions")).getPosRules({ data: data as never }),
  "pos-rules.savePosRules": async (data) => (await import("./pos-rules.functions")).savePosRules({ data: data as never }),
  "pos-rules.verifyManagerPin": async (data) => (await import("./pos-rules.functions")).verifyManagerPin({ data: data as never }),
  "pos-rules.assertShiftClosable": async (data) => (await import("./pos-rules.functions")).assertShiftClosable({ data: data as never }),
});
const bodySchema = z.object({ action: z.string().max(100), data: z.record(z.string(), z.unknown()) });
export async function handleHostedFunctionRequest(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 512 * 1024)
      return Response.json({ error: "App request is too large" }, { status: 413 });
    const body = bodySchema.parse(JSON.parse(raw));
    if (!Object.hasOwn(handlers, body.action))
      return Response.json({ error: "Unknown app operation" }, { status: 400 });
    // The original server function applies its existing schema and authorization.
    const result = await handlers[body.action](body.data);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Invalid app request" }, { status: 400 });
  }
}
