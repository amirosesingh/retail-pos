import { expect, it } from "vitest";
import { usernamePasswordFailure } from "../username-password-failure";

it("requires an explicit password-verifier refusal before showing wrong credentials", () => {
  expect(usernamePasswordFailure(401, { code: "invalid_credentials" })).toBe("invalid-credentials");
  expect(usernamePasswordFailure(401, null)).toBe("cloud-unreachable");
  expect(usernamePasswordFailure(401, { code: "invalid_api_key" })).toBe("configuration-invalid");
});
it("preserves locks, authorization denials and provider outage distinctions", () => {
  expect(usernamePasswordFailure(429, { code: "locked" })).toBe("unknown-error");
  expect(usernamePasswordFailure(403, null)).toBe("permission-denied");
  expect(usernamePasswordFailure(503, { code: "central_unavailable" })).toBe("cloud-unreachable");
  expect(usernamePasswordFailure(504, null)).toBe("cloud-unreachable");
});
