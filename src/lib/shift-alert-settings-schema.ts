import { z } from "zod";
export const shiftAlertSettingsSchema = z.object({
  inApp: z.boolean(), whatsapp: z.boolean(), push: z.boolean(),
  recipients: z.array(z.string().regex(/^\d{6,30}$/)).max(20),
  quietFrom: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  quietTo: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), quietHours: z.boolean(),
}).strict();
