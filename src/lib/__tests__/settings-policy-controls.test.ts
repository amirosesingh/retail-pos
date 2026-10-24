import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: false, locked: true, branch: "branch-a", loading: false, rejectEffectiveSettings: false }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ isAdmin: mocks.admin }) }));
vi.mock("@/lib/pos-store", () => ({ usePos: () => ({
  get state() {
    if (mocks.rejectEffectiveSettings) throw new Error("A company policy must not read branch-resolved settings");
    return { settings: { integrations: { requireTransferApproval: true } } };
  },
  configuredGlobalSettings: { visibility: { hidden: {} } }, updateGlobalSettings: vi.fn(),
  settingsScope: { locks: { transferApproval: mocks.locked } },
  scopeIds: { BRANCH: mocks.branch }, settingsScopeLoading: mocks.loading,
  updateSettings: vi.fn(), saveConfiguredSettings: vi.fn(),
}) }));
import { OperationalRulesPanel } from "@/platforms/web/components/pos/settings/panels/OperationalRulesPanel";
import { TableColumnRulesPanel } from "@/platforms/web/components/admin/TableColumnRulesPanel";
beforeEach(() => { mocks.admin = false; mocks.locked = true; mocks.branch = "branch-a"; mocks.loading = false; mocks.rejectEffectiveSettings = false; });
const render = (canEdit = true) => renderToStaticMarkup(createElement(OperationalRulesPanel, { canEdit }));
describe("operational policy editability matches saved ownership", () => {
  it("opens company table configuration without reading inherited branch settings", () => {
    mocks.admin = true;
    mocks.rejectEffectiveSettings = true;
    expect(renderToStaticMarkup(createElement(TableColumnRulesPanel, { roles: [] }))).toContain("Configure columns");
  });
  it("does not offer a successful-looking edit that branch settings will refuse", () => {
    expect(render()).toContain('disabled=""');
    mocks.locked = false;
    expect(render()).not.toContain('disabled=""');
    mocks.branch = "";
    expect(render()).toContain('disabled=""');
  });
  it("preserves administrator editing and permission/loading interlocks", () => {
    mocks.admin = true;
    expect(render()).not.toContain('disabled=""');
    expect(render(false)).toContain('disabled=""');
    mocks.loading = true;
    expect(render()).toContain('disabled=""');
  });
});
