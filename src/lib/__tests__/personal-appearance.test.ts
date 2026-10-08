import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONAL_APPEARANCE, personalAppearanceSchema } from "../personal-appearance-schema";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (data: unknown) => unknown) => ({ handler: (handle: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => handle({ data: parse(input.data) }) }) }) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
import { loadPersonalAppearance, savePersonalAppearance } from "../personal-appearance.functions";
import { saveGlobalShiftAlerts } from "../shift-alert-settings.functions";
import { loadNotificationSettings, saveNotificationSettings } from "../activity-events.functions";
const person = { kind: "cashier", staffUserId: "person-a", role: "staff", permissions: { can_customize_display: true, can_access_pos_settings: true } };
beforeEach(() => { mocks.scope.mockReset().mockResolvedValue(person); mocks.rest.mockReset().mockResolvedValue(new Response("[]", { status: 200 })); });
describe("personal appearance boundaries", () => {
  it("validates display sizes and rejects business/notification properties", () => {
    expect(personalAppearanceSchema.safeParse(DEFAULT_PERSONAL_APPEARANCE).success).toBe(true);
    expect(personalAppearanceSchema.safeParse({ ...DEFAULT_PERSONAL_APPEARANCE, notifications: {} }).success).toBe(false);
    expect(personalAppearanceSchema.safeParse({ ...DEFAULT_PERSONAL_APPEARANCE, tax: {} }).success).toBe(false);
    expect(personalAppearanceSchema.safeParse({ ...DEFAULT_PERSONAL_APPEARANCE, scale: { ...DEFAULT_PERSONAL_APPEARANCE.scale, scale: Infinity } }).success).toBe(false);
  });
  it("persists only the verified person's private scope", async () => {
    await savePersonalAppearance({ data: { owner: "person-a", profile: DEFAULT_PERSONAL_APPEARANCE } });
    const body = JSON.parse(mocks.rest.mock.calls[0][1].body);
    expect(body).toMatchObject({ scope: "PRIVATE", scope_id: "person-a", key: "personal_appearance" });
  });
  it("refuses an old user's request after the terminal changes identity", async () => {
    await expect(savePersonalAppearance({ data: { owner: "person-b", profile: DEFAULT_PERSONAL_APPEARANCE } })).rejects.toThrow("Sign in");
    await expect(loadPersonalAppearance({ data: { owner: "person-b" } })).rejects.toThrow("Sign in");
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("honours Staff Management's explicit appearance refusal", async () => {
    mocks.scope.mockResolvedValue({ ...person, permissions: { can_customize_display: false } });
    await expect(savePersonalAppearance({ data: { owner: "person-a", profile: DEFAULT_PERSONAL_APPEARANCE } })).rejects.toThrow("disabled");
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("does not let terminal activation alone modify personal preferences", async () => {
    mocks.scope.mockResolvedValue({ ...person, kind: "terminal" });
    await expect(savePersonalAppearance({ data: { owner: "person-a", profile: DEFAULT_PERSONAL_APPEARANCE } })).rejects.toThrow("Sign in");
  });
  it("does not let delegated branch settings permission change global notifications", async () => {
    await expect(loadNotificationSettings({ data: {} })).resolves.toMatchObject({ ok: false });
    await expect(saveNotificationSettings({ data: { settings: { enabled: true, recipients: [], criticalOnly: false, quietFrom: "", quietTo: "", channels: {} } } })).resolves.toMatchObject({ ok: false });
    await expect(saveGlobalShiftAlerts({ data: { settings: { inApp: true, whatsapp: false, push: false, recipients: [], quietFrom: "22:00", quietTo: "07:00", quietHours: false } } })).rejects.toThrow("administrators");
    expect(mocks.rest).not.toHaveBeenCalled();
  });
});
