import { describe, expect, it } from "vitest";
import { connectionLabel } from "./connection-label";
describe("phone connection messages", () => {
  it("never calls an unconfigured terminal an internet outage", () => {
    expect(connectionLabel("offline", "unconfigured", "configuration")).toBe("Connection setup required");
    expect(connectionLabel("offline", "rejected", "authentication")).toBe("Sign-in required");
    expect(connectionLabel("offline", "unreachable", "transport")).toBe("Cannot reach server");
  });
  it("shows recovery only for a verified backend", () => {
    expect(connectionLabel("online", "verified", "none")).toBe("Online");
    expect(connectionLabel("connecting", "unreachable", "transport")).toBe("Checking connection");
  });
});
