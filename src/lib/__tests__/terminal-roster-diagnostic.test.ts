import { expect, it } from "vitest";
import { terminalRosterDiagnostic } from "../terminal-roster-diagnostic";

const token = "fixture-private-terminal-id";
const proof = "a".repeat(64);
const outgoingProof = { terminalToken: token, deviceBindingProof: proof };
const nativeResult = { ok: true, config: { tokenId: token, deviceBindingProof: proof } };
const empty = { backendOrigin: "", tokenPresent: false, proofPresent: false,
  nativeReadable: false, nativeRegistered: false, nativeProofPresent: false, sameToken: false, sameProof: false };

it("reports matching saved registration without returning its identifiers or proof", () => {
  expect(terminalRosterDiagnostic({ backendUrl: "https://pos.fixture/path?q=private#private", outgoingProof, nativeResult, status: 401 }))
    .toEqual({ backendOrigin: "https://pos.fixture", tokenPresent: true, proofPresent: true,
      nativeReadable: true, nativeRegistered: true, nativeProofPresent: true, sameToken: true, sameProof: true, status: 401 });
});

it("reports mismatch and absent values as booleans without assuming two missing values match", () => {
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof,
    nativeResult: { ok: true, config: { tokenId: "different-private-id", deviceBindingProof: "b".repeat(64) } } }))
    .toEqual({ ...empty, tokenPresent: true, proofPresent: true, nativeReadable: true, nativeRegistered: true, nativeProofPresent: true });
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: {}, nativeResult: { ok: true, config: {} } }))
    .toEqual({ ...empty, nativeReadable: true });
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: { terminalToken: token }, nativeResult }))
    .toEqual({ ...empty, tokenPresent: true, nativeReadable: true, nativeRegistered: true, nativeProofPresent: true, sameToken: true });
});

it("distinguishes readable empty native storage from a failed read", () => {
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: null, nativeResult: { ok: true, config: null } }))
    .toEqual({ ...empty, nativeReadable: true });
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof,
    nativeResult: { ok: false, config: nativeResult.config, error: "fixture-vault-secret-error" } }))
    .toEqual({ ...empty, tokenPresent: true, proofPresent: true });
});

it.each([null, undefined, [], "fixture-secret", 42, true, { terminalToken: {}, deviceBindingProof: [] }])(
  "ignores malformed proof/native shapes %j", value => {
    expect(terminalRosterDiagnostic({ backendUrl: value, outgoingProof: value, nativeResult: value })).toEqual(empty);
  },
);

it.each(["not-a-url-private", "/private/relative", "https://", "data:text/plain,fixture-secret", "javascript:fixture-secret"])(
  "never emits a malformed or opaque backend address %s", backendUrl => {
    expect(terminalRosterDiagnostic({ backendUrl, outgoingProof: null, nativeResult: null })).toEqual(empty);
  },
);

it("strips URL credentials, paths, queries, fragments and all unrelated credential/error fields", () => {
  const result = terminalRosterDiagnostic({
    backendUrl: "https://fixture-user:fixture-password@POS.fixture:8443/private-path?key=fixture-query-secret#fixture-fragment",
    outgoingProof: { ...outgoingProof, serviceKey: "fixture-service-key", pin: "fixture-pin" },
    nativeResult: { ...nativeResult, error: "fixture-error", config: { ...nativeResult.config, supabaseKey: "fixture-cloud-key" } },
  });
  expect(result).toEqual({ ...empty, backendOrigin: "https://pos.fixture:8443", tokenPresent: true, proofPresent: true,
    nativeReadable: true, nativeRegistered: true, nativeProofPresent: true, sameToken: true, sameProof: true });
  const output = JSON.stringify(result);
  for (const secret of [token, proof, "fixture-user", "fixture-password", "private-path", "fixture-query-secret", "fixture-fragment",
    "fixture-service-key", "fixture-pin", "fixture-error", "fixture-cloud-key"]) expect(output).not.toContain(secret);
});

it.each([undefined, null, "401", NaN, Infinity, { error: "fixture-private-error" }])("omits a nonnumeric status %j", status => {
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: null, nativeResult: null, status })).toEqual(empty);
});

it("does not mutate the supplied snapshots", () => {
  const input = { backendUrl: "http://localhost:8080/private", outgoingProof: { ...outgoingProof }, nativeResult: structuredClone(nativeResult) };
  const original = structuredClone(input);
  terminalRosterDiagnostic(input);
  expect(input).toEqual(original);
});

it("compares valid hexadecimal proofs without a case-only mismatch", () => {
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: { ...outgoingProof, deviceBindingProof: proof.toUpperCase() }, nativeResult }))
    .toMatchObject({ nativeProofPresent: true, sameProof: true });
});

it.each(["", " ", "a".repeat(63), "g".repeat(64), "fixture-invalid-proof"])(
  "never treats two absent or malformed proofs as a confirmed match: %j", value => {
    expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof: { deviceBindingProof: value },
      nativeResult: { ok: true, config: { tokenId: token, deviceBindingProof: value } } }))
      .toMatchObject({ nativeProofPresent: Boolean(value.trim()), sameProof: false });
  },
);

it("reports a missing native proof separately from a mismatched existing proof", () => {
  expect(terminalRosterDiagnostic({ backendUrl: null, outgoingProof, nativeResult: { ok: true, config: { tokenId: token } } }))
    .toMatchObject({ tokenPresent: true, proofPresent: true, nativeReadable: true, nativeRegistered: true, nativeProofPresent: false, sameToken: true, sameProof: false });
});
