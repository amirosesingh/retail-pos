import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// The native fixture supplies a real signed checkout and the disposable
// Postgres fixture supplies its service-role RPC. Only HTTPS transport and
// the Data API metadata reads are adapted in process.
export async function verifyAttestedCashRelay({ wire, proof, invokeRpc, invokeRead }) {
  const { build } = await import("esbuild");
  const { CloudClient } = createRequire(import.meta.url)("../../electron/sync/cloud-client.cjs");
  const project = wire.attestation.projectOrigin;
  const backend = "https://cash-relay-fixture.invalid";
  const { terminalId, branchId } = wire.scope;
  const env = {
    POS_GROUPED_FEED_PILOT_PROJECT_URL: project, POS_GROUPED_FEED_PILOT_TERMINAL_ID: terminalId,
    POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED: "true", POS_GROUPED_CASH_UPLOAD_PILOT_ENABLED: "true",
    POS_SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const bundled = await build({
    absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)),
    entryPoints: ["src/lib/sync-endpoint.server.ts"], bundle: true, write: false, format: "esm",
    platform: "browser", target: "es2022", external: ["node:*"],
    plugins: [{
      name: "disposable-cash-relay",
      setup(build) {
        build.onResolve({ filter: /external-supabase-config$|commerce-sync-readiness\.server$/ }, args => ({
          path: args.path, namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
          contents: args.path.endsWith("external-supabase-config")
            ? `export const supabaseConfig=()=>({url:${JSON.stringify(project)},key:"fixture-public"});
               export const runtimeEnvValue=name=>(${JSON.stringify(env)})[name];`
            : "export const commerceSyncIsolationReady=async()=>true;",
        }));
      },
    }],
  });
  const url = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`;
  const { handleSyncRequest } = await import(url);
  const upstream = globalThis.fetch;
  let writes = 0;
  const author = wire.attestation;
  globalThis.fetch = async (target, options) => {
    const address = new URL(target);
    if (address.origin === backend) {
      const body = JSON.parse(options.body);
      if (body.sqlServerCashCheckout) {
        assert.equal(options.redirect, "error");
        assert.deepEqual(Object.keys(body).sort(), ["deviceBindingProof", "sqlServerCashCheckout", "terminalToken"]);
      }
      return handleSyncRequest(new Request(target, options));
    }
    assert.equal(address.origin, project);
    assert.equal(new Headers(options?.headers).get("apikey"), env.POS_SUPABASE_SERVICE_ROLE_KEY);
    if (address.pathname === "/rest/v1/terminal_tokens") {
      assert.equal(address.searchParams.get("id"), "eq." + terminalId);
      return Response.json([{
        id: terminalId, platform: "pc", location_id: branchId, status: "used", is_claimed: true,
        revoked_at: null, claim_proof: proof, claimed_platform: "electron",
      }]);
    }
    if (address.pathname === "/rest/v1/stores") return Response.json([{ id: branchId }]);
    if (address.pathname === "/rest/v1/rpc/pos_shift_author_key") {
      assert.deepEqual(JSON.parse(options.body), {
        p_project_origin: project, p_terminal_id: terminalId, p_author_id: author.authorId, p_key_id: author.keyId,
      });
      return Response.json({ terminal_enrolled: true, key: {
        key_id: author.keyId, author_id: author.authorId, terminal_id: terminalId, project_origin: project,
        public_key: wire.publicKey, subject: author.subject, revoked_at: null,
      } });
    }
    if (address.pathname === "/rest/v1/app_users") {
      assert.equal(address.searchParams.get("id"), "eq." + author.authorId);
      return Response.json([{ id: author.authorId, user_id: author.subject, role: "staff", role_slug: "cashier",
        permissions: { can_process_sale: true }, store_id: branchId, is_active: true }]);
    }
    if (/^\/rest\/v1\/rpc\/pos_sync_(pull|snapshot)_cash_settings_v1$/.test(address.pathname))
      return Response.json(invokeRead(address.pathname.split("/").at(-1), JSON.parse(options.body)));
    assert.equal(address.pathname, "/rest/v1/rpc/pos_sync_cash_checkout_attested_v1");
    assert.deepEqual(JSON.parse(options.body), {
      p_organization_id: "default", p_branch_id: branchId, p_terminal_id: terminalId, p_binding_proof: proof,
      p_installation_generation: wire.scope.installationGeneration, p_database_guid: wire.scope.databaseGuid,
      p_operation_id: wire.operationId, p_epoch: wire.scope.feedEpoch,
      p_checkout_json: wire.checkoutJson, p_checkout_sha256: wire.checkoutSha256,
      p_author_key_id: author.keyId, p_author_id: author.authorId, p_author_subject: author.subject, p_project_origin: project,
    });
    writes++;
    return Response.json(await invokeRpc());
  };
  try {
    const manager = { pool: {}, profile: { id: "cash-relay", host: "fixture", database: "fixture" } };
    const cloud = new CloudClient({ connectionManager: manager, configStore: { get: () => backend },
      terminalStore: { read: () => ({ tokenId: terminalId, deviceUse: "operations", deviceType: "pc",
        locationId: branchId, deviceBindingProof: proof }) },
      financialBasisContext: () => ({ branchId, projectOrigin: project }) });
    const source = cloud.requestContext(false);
    const changed = author.signature[0] === "a" ? "b" : "a";
    await assert.rejects(cloud.submitCashCheckout(source, {
      ...wire, attestation: { ...author, signature: changed + author.signature.slice(1) },
    }), error => error.status === 403);
    assert.equal(writes, 0);
    const result = await cloud.submitCashCheckout(source, wire);
    assert.equal(writes, 1);
    assert.equal(result.result.author_id, author.authorId);
    const page = await cloud.pullGroupedSettings(source, { epoch: wire.scope.feedEpoch, seq: "0", upper: null }, 10,
      "settings_cash_v1");
    assert.equal(page.next_seq, result.result.seq);
    assert.equal(page.groups.length, 1);
    assert.equal(page.groups[0].acceptance.checkout_sha256, wire.checkoutSha256);
    const snapshot = await cloud.groupedSettingsSnapshot(source, "settings_cash_v1");
    assert.deepEqual(JSON.parse(snapshot.manifest_json).cash_groups, page.groups);
    console.log("PASS signed LocalDB cash upload and mixed download/snapshot through the actual relay and PostgreSQL");
    return result;
  } finally { globalThis.fetch = upstream; }
}
