import { hostedFunction } from "./hosted-function-client";
import { sendWhatsAppBill as sendWhatsAppBillDirect } from "./whatsapp.functions";
export const sendWhatsAppBill = hostedFunction("whatsapp.sendWhatsAppBill", sendWhatsAppBillDirect);
