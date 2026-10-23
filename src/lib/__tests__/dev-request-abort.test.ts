import { expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleDisconnectedRequest, disconnectedRequestRecovery } from "../../../scripts/dev-request-abort";
const response = {} as ServerResponse;
it("consumes only confirmed client-disconnected requests", () => {
  const next = vi.fn();
  handleDisconnectedRequest({ code: "ECONNRESET", message: "aborted" }, { aborted: true } as IncomingMessage, response, next);
  expect(next).not.toHaveBeenCalled();
});
it.each([
  [{ code: "ECONNRESET", message: "aborted" }, false],
  [{ code: "ECONNRESET", message: "upstream disconnected" }, true],
  [new Error("Database failed"), true],
  [{ name: "AbortError", message: "Timeout" }, false],
])("preserves genuine errors and requests still awaiting responses", (error, aborted) => {
  const next = vi.fn();
  handleDisconnectedRequest(error, { aborted } as IncomingMessage, response, next);
  expect(next).toHaveBeenCalledWith(error);
});
it("never changes production middleware", () => {
  expect(disconnectedRequestRecovery().apply).toBe("serve");
});
