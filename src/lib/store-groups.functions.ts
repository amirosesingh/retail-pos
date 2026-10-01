import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const proof = {
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  accessToken: z.string().max(4000).optional(),
};

const row = z.object({
  id: z.string().min(1).max(80),
  code: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  is_active: z.boolean(),
  archived_at: z.string().datetime().nullable(),
});

export const loadStoreGroupsForCaller = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object(proof).parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      await requireCallerScope(data);
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest(
        "store_groups?select=id,code,name,is_active,archived_at&order=name.asc",
      );
      if (!response.ok) throw new Error("The store groups could not be loaded.");
      return { ok: true as const, rows: (await response.json()) as z.infer<typeof row>[] };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message, rows: [] };
    }
  });

export const saveStoreGroupForCaller = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ ...proof, group: row }).parse(input))
  .handler(async ({ data }) => {
    try {
      const { requireCallerScope } = await import("./privileged-caller.server");
      await requireCallerScope(data, { supervisor: true });
      const { serviceRest } = await import("@/core/api/pos-relay.server");
      const response = await serviceRest(
        "store_groups?on_conflict=id&select=id,code,name,is_active,archived_at",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([data.group]),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(detail || "The store group could not be saved.");
      }
      const saved = ((await response.json()) as z.infer<typeof row>[])[0];
      if (!saved) throw new Error("The store group was not returned after saving.");
      return { ok: true as const, group: saved };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  });
