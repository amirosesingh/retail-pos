import { createServerFn } from "@tanstack/react-start";

/** Anonymous routing metadata only; never return the full integration settings. */
export const readPublicHostConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { readPublicHostConfigServer } = await import("./public-host-config.server");
  return readPublicHostConfigServer();
});
