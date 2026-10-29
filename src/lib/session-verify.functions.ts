import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  sessionToken: z.string().max(400).optional(),
  cashierToken: z.string().max(2000).optional(),
  terminalToken: z.string().max(200).optional(),
  deviceBindingProof: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  accessToken: z.string().max(4000).optional(),
  storeId: z.string().max(64).optional(),
});

/** `/auth/verify-session` for tills: token still live and branch still there. */
export const verifySession = createServerFn({ method: "POST" })
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data }) => {
    const { verifySessionServer } = await import("./session-verify.server");
    return verifySessionServer(data);
  });
