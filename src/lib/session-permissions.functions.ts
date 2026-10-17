import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Refresh only the person proved by the session, never a renderer-selected user. */
export const readSessionPermissions = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({
    sessionToken: z.string().max(400).optional(),
    cashierToken: z.string().max(2000).optional(),
    terminalToken: z.string().max(200).optional(),
    accessToken: z.string().max(4000).optional(),
  }).parse(input))
  .handler(async ({ data }) => {
    const { readSessionPermissionsServer } = await import("./session-permissions.server");
    return readSessionPermissionsServer(data);
  });
