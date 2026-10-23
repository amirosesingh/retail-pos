import {describe,expect,it,vi,beforeEach} from "vitest";
const rest = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/pos-relay.server", () => ({serviceRest: rest}));
import {writeNotificationSection,DEFAULT_NOTIFICATION_SETTINGS} from "../activity-events.server";
import {defaultAndroidPushRules} from "../android-push-policy";
beforeEach(() => vi.resetAllMocks());
describe("independent notification delivery settings", () => {
  it("saves in-app types without changing phone delivery or WhatsApp", async () => {
    const current = {...DEFAULT_NOTIFICATION_SETTINGS, recipients:["60111111"], channels:{sale_complete:"whatsapp" as const}};
    rest.mockResolvedValueOnce(Response.json([{notification_settings:current}])).mockResolvedValueOnce(Response.json([{}]));
    const incoming = {...DEFAULT_NOTIFICATION_SETTINGS, inApp:{soft_token_approval:false}};
    expect(await writeNotificationSection(incoming,"app")).toMatchObject({
      recipients:["60111111"],channels:{sale_complete:"whatsapp"},inApp:{soft_token_approval:false},
    });
  });
  it("preserves a concurrent WhatsApp save while saving Android rules", async () => {
    const current = {...DEFAULT_NOTIFICATION_SETTINGS,recipients:["60111111"]};
    const newer = {...current,recipients:["60222222"],criticalOnly:true};
    rest.mockResolvedValueOnce(Response.json([{notification_settings:current}]))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{notification_settings:newer}]))
      .mockResolvedValueOnce(Response.json([{}]));
    const incoming = {...current,androidPush:{...defaultAndroidPushRules,enabled:true,recipients:["staff-1"]}};
    expect(await writeNotificationSection(incoming,"android")).toMatchObject({recipients:["60222222"],criticalOnly:true,androidPush:{enabled:true}});
    expect(rest.mock.calls[3][1].body).toContain('"60222222"');
  });
  it("preserves Android recipients when WhatsApp is saved", async () => {
    const current = {...DEFAULT_NOTIFICATION_SETTINGS,androidPush:{...defaultAndroidPushRules,enabled:true,recipients:["staff-1"]}};
    rest.mockResolvedValueOnce(Response.json([{notification_settings:current}])).mockResolvedValueOnce(Response.json([{}]));
    const incoming = {...DEFAULT_NOTIFICATION_SETTINGS,enabled:false};
    expect(await writeNotificationSection(incoming,"whatsapp")).toMatchObject({enabled:false,androidPush:{enabled:true,recipients:["staff-1"]}});
  });
  it("does not overwrite stored settings when the read fails", async () => {
    rest.mockResolvedValueOnce(new Response(null,{status:503}));
    await expect(writeNotificationSection(DEFAULT_NOTIFICATION_SETTINGS,"android")).rejects.toThrow("Could not read");
    expect(rest).toHaveBeenCalledTimes(1);
  });
});
