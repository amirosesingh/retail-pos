import { serviceRest } from "@/core/api/pos-relay.server";
import { sendWhatsApp } from "./activity-events.server";

/** Claims are durable and exclusive. Ambiguous sends are never blindly retried. */
export async function drainNotificationWhatsApp(limit = 3): Promise<void> {
  const claim = await serviceRest("rpc/claim_notification_whatsapp", {
    method: "POST",
    body: JSON.stringify({ p_limit: limit }),
  });
  if (!claim.ok) return; // An older tenant retains its legacy delivery path.
  const deliveries = (await claim.json()) as { id: string; recipient: string; message: string }[];
  await Promise.all(
    deliveries.map(async (delivery) => {
      let status = "sent",
        reason = "WhatsApp accepted the message";
      try {
        const failure = await sendWhatsApp(delivery.recipient, delivery.message);
        if (failure) {
          status = "failed";
          reason = failure;
        }
      } catch {
        status = "unknown";
        reason = "Delivery result is unknown; automatic retry could duplicate the message";
      }
      await serviceRest(
        `notification_deliveries?id=eq.${encodeURIComponent(delivery.id)}&status=eq.sending`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            reason,
            ...(status === "sent" ? { delivered_at: new Date().toISOString() } : {}),
          }),
        },
      );
    }),
  );
}
