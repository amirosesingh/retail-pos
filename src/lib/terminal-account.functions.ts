import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  tokenId: z.string().uuid(),
  /** HMAC made with the key that is sealed on the claiming device. */
  proofHash: z.string().min(32).max(256),
});

/**
 * Hand an activated terminal its own machine account so its writes are
 * accepted by the central database under the normal row rules.
 */
export const getTerminalAccount = createServerFn({ method: "POST" })
  .validator((data: unknown) => input.parse(data))
  .handler(async ({ data }): Promise<
    { ok: true; email: string; password: string } | { ok: false; error: string }
  > => {
    try {
      const { ensureTerminalAccount } = await import("./terminal-account.server");
      const account = await ensureTerminalAccount(data.tokenId, data.proofHash);
      return { ok: true, ...account };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
