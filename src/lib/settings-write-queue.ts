/** Only these complete JSON setting snapshots can replace a waiting edit. */
export function settingsWriteGroup(patch: Record<string, unknown>): string | undefined {
  if (Object.keys(patch).length !== 1) return;
  if (patch.payment) return "payment";
  if (patch.whatsapp) return "whatsapp";
  const keys = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  const integrations = keys(patch.integrations);
  if (integrations.length && integrations.every(key => ["paymentAccounts", "usePaymentAccounts"].includes(key))) return "paymentAccounts";
  if (integrations.length && integrations.every(key => ["bookingRules", "serviceTypes", "useServiceTypes", "allowCustomServiceType", "requireBookingCustomer", "baseLaborFee", "racketModels", "stringModels"].includes(key))) return "booking";
  const receipt = keys(patch.receipt);
  if (receipt.length === 1 && receipt[0] === "bookingSlip") return "bookingSlip";
  if (receipt.length) return "receipt";
}

/** Serialize edits per scope and retain failed writes for an explicit retry. */
export class SettingsWriteQueue {
  private entries = new Map<string, { save: () => Promise<unknown>; result: Promise<{ error?: unknown }> }>();
  private latest = new Map<string, { group: string; save: () => Promise<unknown> }>();
  revision = 0;
  get pending() { return this.entries.size > 0; }
  enqueue(key: string, save: () => Promise<unknown>) {
    this.latest.delete(key);
    this.revision++;
    const previous = this.entries.get(key)?.result ?? Promise.resolve({});
    const result = previous.then(save).then(() => ({}), (error: unknown) => ({ error }));
    const entry = { save, result };
    this.entries.set(key, entry);
    void result.then((outcome) => {
      if (!("error" in outcome) && this.entries.get(key) === entry) this.entries.delete(key);
    });
  }
  /** Replace waiting snapshots of the same complete section, never an in-flight write. */
  enqueueLatest(key: string, group: string, save: () => Promise<unknown>) {
    const waiting = this.latest.get(key);
    if (waiting?.group === group) {
      waiting.save = save;
      this.revision++;
      return;
    }
    const entry = { group, save };
    this.enqueue(key, () => {
      if (this.latest.get(key) === entry) this.latest.delete(key);
      return entry.save();
    });
    this.latest.set(key, entry);
  }
  async flush() {
    while (this.entries.size) {
      for (const [key, entry] of [...this.entries]) {
        const outcome = await entry.result;
        if ("error" in outcome) await entry.save();
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
    }
  }
}
