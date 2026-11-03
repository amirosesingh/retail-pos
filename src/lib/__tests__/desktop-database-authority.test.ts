import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRest } = vi.hoisted(() => ({ serviceRest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest }));

import { databaseAuthority } from "../desktop-database-authority.server";

describe("desktop database authority", () => {
  beforeEach(() => serviceRest.mockReset());

  it("uses the full administrator preset even when an old row stores false", async () => {
    serviceRest.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          user_id: "admin-1",
          role: "admin",
          role_slug: "admin",
          permissions: { can_manage_sync_backup: false },
          store_id: "branch-7",
          is_active: true,
        },
      ],
    });
    await expect(databaseAuthority({ userId: "admin-1" })).resolves.toMatchObject({
      level: "admin",
      branchId: "branch-7",
      permissions: { can_manage_sync_backup: true },
    });
  });

  it("returns stable author identity only through an exact verified id or Auth lookup", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const row = { id, user_id: "cashier", role: "staff", role_slug: "cashier", permissions: { can_shift_cash_count: true }, store_id: "A", is_active: true };
    serviceRest.mockResolvedValue({ ok: true, json: async () => [row] });
    expect(await databaseAuthority({ appUserId: id, userId: "other", email: "other@example.test" })).toMatchObject({ authorId: id, subject: "cashier" });
    expect(serviceRest).toHaveBeenCalledWith(expect.stringContaining(`id=eq.${id}&`));
    expect(await databaseAuthority({ userId: "cashier" })).not.toHaveProperty("authorId");
    expect(await databaseAuthority({ authUserId: "verified-auth" })).toMatchObject({ authorId: id });
    serviceRest.mockResolvedValue({ ok: true, json: async () => [] });
    serviceRest.mockClear();
    expect(await databaseAuthority({ appUserId: id, userId: "cashier", email: "cashier@example.test" })).toBeNull();
    expect(serviceRest).toHaveBeenCalledTimes(1);
  });
});
