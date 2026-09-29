import { describe, expect, it } from "vitest";
import { classifyError, describeError } from "@/lib/notify";
import { isTokenRejection } from "@/lib/session-expiry";

describe("standard error classification", () => {
  const cases = [
    [400, "invalid-request"],
    [401, "authentication"],
    [403, "permission"],
    [404, "not-found"],
    [408, "timeout"],
    [409, "conflict"],
    [422, "validation"],
    [429, "rate-limit"],
    [500, "server"],
    [502, "upstream"],
    [503, "unavailable"],
    [504, "timeout"],
  ] as const;

  it.each(cases)("maps HTTP %s to %s", (status, category) => {
    expect(classifyError({ status, message: `HTTP ${status}` })).toBe(category);
  });

  it("classifies platform failures without requiring an HTTP response", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe("network");
    expect(classifyError({ code: "ENOTCONNECTED", message: "database not connected" })).toBe(
      "database-disconnected",
    );
    expect(classifyError(new Error("operation already running"))).toBe("already-running");
    expect(classifyError(new Error("configuration missing key"))).toBe("configuration");
  });
});

describe("session rejection detection", () => {
  it("expires definite authentication failures", () => {
    expect(isTokenRejection(401, "Unauthorized")).toBe(true);
    expect(isTokenRejection(403, "JWT expired")).toBe(true);
    expect(isTokenRejection(403, "Session not found")).toBe(true);
    expect(isTokenRejection(400, "refresh_token_not_found")).toBe(true);
  });

  it("does not turn permissions or server failures into a logout", () => {
    expect(isTokenRejection(403, "row-level security policy denied this action")).toBe(false);
    expect(isTokenRejection(503, "Service unavailable")).toBe(false);
  });
});

describe("action-specific safe wording", () => {
  it("gives different recovery wording for the same authentication failure", () => {
    const error = { status: 401, message: "raw token value must not appear" };
    expect(describeError(error, "Signing in")).toContain("sign in again");
    expect(describeError(error, "Cloud sync")).toContain("re-register this terminal");
    expect(describeError(error, "Terminal registration")).toContain("Authenticate the terminal");
  });

  it("does not claim an online-only sale was queued after network failure", () => {
    const message = describeError(new Error("Failed to fetch https://private.example"), "Saving the sale");
    expect(message).toContain("Check your internet connection");
    expect(message).not.toContain("saved on this terminal");
    expect(message).not.toContain("private.example");
  });

  it("confirms no sale save when a database write fails", () => {
    const message = describeError(new Error("SQL insert failed"), "Saving the sale");
    expect(message).toContain("No successful save was confirmed");
    expect(message).not.toContain("SQL insert");
  });

  it("does not describe a failed location load as a database save", () => {
    const message = describeError(
      new Error("Local SQL Server database requires an update before data can be read"),
      "Loading data",
    );
    expect(message).toContain("could not read the database");
    expect(message).not.toContain("could not be saved");
  });

  it("identifies the failed local SQL table without exposing raw SQL", () => {
    const message = describeError(
      {
        code: "ESQLSERVER_WRITE",
        table: "payment_transactions",
        message: "Local SQL Server sale commit failed while writing payment_transactions.",
      },
      "Saving the payment",
    );
    expect(message).toContain("payment_transactions");
    expect(message).toContain("rolled back");
  });

  it("keeps raw SQL, paths and endpoints out of unexpected UI errors", () => {
    const secret = "SELECT * FROM users at C:\\private\\shop.db https://internal.example";
    expect(describeError(new Error(secret), "Loading reports")).not.toContain(secret);
  });
});
