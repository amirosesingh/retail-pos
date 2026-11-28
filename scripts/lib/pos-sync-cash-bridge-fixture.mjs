import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const read = async relative => (await readFile(new URL(relative, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const sqlText = value => `'${value.replaceAll("'", "''")}'`;
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const proof = "a".repeat(64);
const at = "2026-11-07T09:00:00Z";
const serviceClaims = `SET request.jwt.claims = '{"role":"service_role"}';`;
const legacyRole = "SET ROLE service_role;";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyCashBridge({ sql, denySql, session, waitFor, wire, receiving, receiveExtended, attested = false, extended = null, relay }) {
  const saved = wire ? JSON.parse(wire.checkoutJson) : null;
  const branch = wire?.scope.branchId ?? "A";
  const otherBranch = branch === "B" ? "A" : "B";
  const epoch = wire?.scope.feedEpoch ?? randomUUID();
  const terminal = wire?.scope.terminalId ?? randomUUID();
  const installationGeneration = wire?.scope.installationGeneration ?? randomUUID();
  const databaseGuid = wire?.scope.databaseGuid ?? randomUUID();
  const shift = saved?.sale.shift_id ?? randomUUID();
  const product = saved?.item.product_id ?? randomUUID();
  const productName = saved?.item.product_name ?? "Fixture café";
  const price = saved?.item.unit_price ?? "3.10";
  const cost = saved?.item.unit_cost ?? "0";
  assert([epoch, terminal, installationGeneration, databaseGuid, shift, product].every(value => uuid.test(value)));
  if (wire) {
    assert(uuid.test(wire.operationId) && wire.saleId === saved.sale.id);
    assert.equal(saved.sale.store_id, branch);
    const tenders = extended ? saved.tenders : [saved.tender];
    assert.equal(tenders.length, extended === "split" ? 2 : 1);
    assert(tenders.every(tender => tender.terminal_id === terminal));
  }

  const source = await read("../../supabase/schema.sql");
  const definition = (name, definitions = source) => {
    const begin = definitions.lastIndexOf(`\nCREATE OR REPLACE FUNCTION public.${name}(`);
    assert(begin >= 0, `Missing repository function ${name}`);
    const tail = definitions.slice(begin);
    const opening = tail.match(/\bAS\s+(\$[\w]*\$)/i);
    assert(opening, `Missing function body for ${name}`);
    const delimiter = opening[1];
    const end = tail.indexOf(`${delimiter};`, opening.index + opening[0].length);
    assert(end >= 0, `Unclosed function ${name}`);
    return tail.slice(0, end + delimiter.length + 1);
  };
  const table = name => {
    const start = source.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
    assert(start >= 0, `Missing repository table ${name}`);
    const end = source.indexOf(");", start);
    assert(end >= 0);
    const additions = source.match(new RegExp(`ALTER TABLE public\\.${name}\\s+ADD COLUMN IF NOT EXISTS [^;]+;`, "gi")) ?? [];
    const key = name === "stock_delta_applied" ? "movement_id" : "id";
    const primaryKey = ["sync_idempotency_receipts", "pos_store_settings"].includes(name) ? "" : `ALTER TABLE public.${name} ADD PRIMARY KEY(${key});`;
    return [source.slice(start, end + 2), primaryKey, ...additions].join("\n");
  };
  const tables = ["stores", "app_users", "user_roles", "terminal_tokens", "shifts", "products", "sales", "sale_items", "payment_transactions",
    "item_activity_logs", "stock_delta_applied", "sync_idempotency_receipts"];
  if (attested) tables.push("pos_store_settings");
  const routines = ["pos_sync_validate_scope", "has_role", "is_app_supervisor", "is_supervisor_now", "user_store_id",
    "store_visible", "stock_apply_delta", "sync_apply_sales", "sync_delete_sales", "sync_apply_sale_items",
    "sync_delete_sale_items", "sync_apply_payment_transactions", "sync_delete_payment_transactions",
    "sync_apply_item_activity_logs", "sync_delete_item_activity_logs", "sync_apply_stock_delta_applied", "sync_delete_stock_delta_applied",
    "sales_block_closing_shift", "pos_sync_push_aggregate", "pos_sync_push_batch"];
  const compatibility = await read("../../supabase/migrations/20260928071500_restore_shift_notifications_sync_contract.sql");
  const writers = ["public.pos_sync_push_batch(uuid,text,text,text,jsonb,jsonb)",
    "public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)", "public.pos_sync_push_aggregate(uuid,text,text,jsonb)",
    "public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)"].join(", ");
  sql(`SET client_min_messages = warning;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT auth.jwt()->>'role'$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'staff');
    ${tables.map(table).join("\n")}
    CREATE UNIQUE INDEX fixture_sales_bill ON public.sales (bill_number);
    CREATE UNIQUE INDEX fixture_sales_client ON public.sales (client_transaction_id) WHERE client_transaction_id IS NOT NULL;
    ${routines.map(name => definition(name)).join("\n")}
    ${definition("pos_sync_push_aggregate", compatibility)}
    ${definition("pos_sync_push_batch", compatibility)}
    REVOKE ALL ON FUNCTION ${writers} FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION ${writers} TO service_role;
    CREATE TRIGGER sales_block_closing_shift BEFORE INSERT ON public.sales
      FOR EACH ROW EXECUTE FUNCTION public.sales_block_closing_shift();`);

  const preparation = [await read("../preparation/pos-sync-inbox-v1.sql"), await read("../preparation/pos-sync-cash-bridge-v1.sql"),
    await read("../preparation/pos-sync-cash-overlap-v1.sql")];
  if (attested) {
    sql(await read("../../supabase/migrations/20261102101610_shift_author_key_registry.sql"));
    preparation.push(await read("../preparation/pos-sync-stock-movement-proof-v1.sql"));
    for (const name of ["pos-sync-cash-receive-v1.sql", "pos-sync-store-settings-v1.sql", "pos-sync-grouped-gateway-v1.sql",
      "pos-sync-cash-settings-gateway-v1.sql", "pos-sync-cash-legacy-coverage-v1.sql", "pos-sync-cash-attested-gateway-v1.sql"])
      preparation.push(await read(`../preparation/${name}`));
  }
  sql(`BEGIN;\n${preparation.join("\n")}\nCOMMIT;`);
  if (extended) sql(`CREATE FUNCTION pos_sync_feed_v1.extended_scope_epoch(p_org text,p_branch text)
    RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog
    RETURN (SELECT pilot.epoch FROM pos_sync_feed_v1.cash_settings_pilots AS pilot
      WHERE pilot.organization_id=p_org AND pilot.scope_id=p_branch);`);
  sql(`INSERT INTO public.stores (id, code, name) VALUES (${sqlText(branch)}, ${sqlText(branch)}, 'Fixture branch');
    INSERT INTO public.terminal_tokens (id, location_id, device_name, is_claimed, claim_proof, claimed_platform)
    VALUES ('${terminal}', ${sqlText(branch)}, 'Fixture till', true, '${proof}', 'electron');
    INSERT INTO public.products (id, barcode, name, owner_store_id, selling_price, cost_price, stock_quantity, stock_by_store)
    VALUES ('${product}', 'fixture', ${sqlText(productName)}, ${sqlText(branch)}, ${sqlText(String(price))}::numeric,
      ${sqlText(String(cost))}::numeric, 14, ${sqlText(JSON.stringify({ [branch]: 10, [otherBranch]: 4 }))}::jsonb);
    INSERT INTO pos_sync_feed_v1.feed_heads (organization_id, scope_id, epoch) VALUES ('default',${sqlText(branch)},'${epoch}');`);
  await receiving?.prepare({ sql, denySql, branch, epoch, terminal, shift, product });

  const checkout = () => {
    const sale = randomUUID();
    const tender = randomUUID();
    const bill = `fixture-${sale}`;
    return {
      sale: { id: sale, bill_number: bill, client_transaction_id: sale, shift_id: shift, store_id: branch, branch_id: branch,
        subtotal_amount: "3.10", total_amount: "3.10", discount_amount: 0, tax_amount: 0, payment_type: "cash",
        points_earned: 0, points_redeemed: 0, is_exchange: false, is_refunded: false, created_at: at, paid_amount: "3.10",
        change_amount: 0, exchange_credit: 0, coupon_discount: 0, payments: [{ id: tender, method: "cash", amount: "3.10" }],
        rounding_adjustment: 0, row_version: 1 },
      item: { id: randomUUID(), sale_id: sale, product_id: product, product_name: productName, branch_id: branch,
        unit_price: "3.10", quantity: 1, discount_percent: 0, discount_amount: 0, is_return: false, created_at: at,
        tax_rate: 0, is_foc: false, coupon_discount: 0, unit_cost: 0, row_version: 1, refunded_qty: 0 },
      tender: { id: tender, source_type: "sale", sale_id: sale, store_id: branch, shift_id: shift, terminal_id: terminal,
        amount: "3.10", method: "cash", kind: "payment", note: "", paid_at: at, created_at: at, updated_at: at,
        row_version: 1, status: "completed", metadata: {} },
      movement: { id: randomUUID(), product_id: product, store_id: branch, terminal_id: terminal,
        activity_type: "sale", reference: bill, quantity_delta: -1, unit_cost: 0, note: "", created_at: at, row_version: 1 },
    };
  };
  const apply = (operation, payload, overrides = {}) => {
    const checkoutJson = overrides.checkoutJson ?? JSON.stringify(payload);
    return `SELECT pos_sync_cash_v1.apply_checkout(
      'default', ${sqlText(overrides.branch ?? branch)}, '${terminal}', ${sqlText(overrides.proof ?? proof)},
      '${overrides.installationGeneration ?? installationGeneration}', '${overrides.databaseGuid ?? databaseGuid}',
      '${operation}', '${overrides.epoch ?? epoch}', ${sqlText(checkoutJson)},
      '${overrides.checkoutSha256 ?? digest(checkoutJson)}');`;
  };
  const counts = () => sql(`SELECT (SELECT count(*) FROM sales), (SELECT count(*) FROM sale_items),
    (SELECT count(*) FROM payment_transactions), (SELECT count(*) FROM item_activity_logs),
    (SELECT count(*) FROM stock_delta_applied), (SELECT head_seq FROM pos_sync_feed_v1.feed_heads
      WHERE organization_id = 'default' AND scope_id = ${sqlText(branch)}),
    (SELECT stock_by_store->>${sqlText(branch)} FROM products), (SELECT stock_by_store->>${sqlText(otherBranch)} FROM products);`);
  const operationRows = (table, rows = [], changes = []) => ({ table, rows, changes });
  const legacyBatch = (id, { table, rows, changes }, compatible = false) => `${legacyRole} SELECT public.pos_sync_push_batch(
    '${id}', 'default', ${sqlText(branch)}, ${compatible ? "" : `'${terminal}', `}${sqlText(table)},
    ${sqlText(JSON.stringify(rows))}::jsonb, ${sqlText(JSON.stringify(changes))}::jsonb);`;
  const legacyAggregate = (id, operations, compatible = false) => `${legacyRole} SELECT public.pos_sync_push_aggregate(
    '${id}', 'default', ${sqlText(branch)}, ${compatible ? "" : `'${terminal}', `}${sqlText(JSON.stringify(operations))}::jsonb);`;

  const first = saved ?? checkout();
  const operation = wire?.operationId ?? randomUUID();
  const checkoutJson = wire?.checkoutJson ?? JSON.stringify(first);
  if (wire) assert.equal(wire.checkoutSha256, digest(checkoutJson));
  const checkoutSha256 = wire?.checkoutSha256 ?? digest(checkoutJson);
  if (attested) {
    const author = wire?.attestation;
    assert(author && wire.publicKey && author.payloadHash === checkoutSha256);
    const scope = `'default',${sqlText(branch)},'${epoch}'`;
    const settingsColumns = source.match(/ALTER TABLE public\.pos_store_settings\s+ADD COLUMN IF NOT EXISTS [^;]+;/g) ?? [];
    sql(`${settingsColumns.join("\n")}
      INSERT INTO public.pos_store_settings (store_id) VALUES (${sqlText(branch)});
      INSERT INTO pos_sync_cash_v1.installation_enrollments
      (organization_id,terminal_id,branch_id,installation_generation,database_guid)
      VALUES ('default','${terminal}',${sqlText(branch)},'${installationGeneration}','${databaseGuid}');
      INSERT INTO public.app_users (id,user_id,full_name,email,store_id,permissions)
      VALUES ('${author.authorId}',${sqlText(author.subject)},'Original cashier','fixture@invalid.test',${sqlText(branch)},
        '{"can_process_sale":true}');
      INSERT INTO pos_sync_private.shift_author_keys(key_id,author_id,terminal_id,project_origin,subject,public_key)
      VALUES ('${author.keyId}','${author.authorId}','${terminal}',${sqlText(author.projectOrigin)},
        ${sqlText(author.subject)},${sqlText(wire.publicKey)});
      INSERT INTO pos_sync_feed_v1.settings_pilots(organization_id,scope_id,epoch) VALUES (${scope});
      INSERT INTO public.shifts(id,store_id,terminal_id,status,state) VALUES ('${shift}',${sqlText(branch)},'${terminal}','OPEN','ACTIVE');`);
    const args = {
      p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_binding_proof: proof,
      p_installation_generation: installationGeneration, p_database_guid: databaseGuid, p_operation_id: operation,
      p_epoch: epoch, p_checkout_json: checkoutJson, p_checkout_sha256: checkoutSha256,
      p_author_key_id: author.keyId, p_author_id: author.authorId, p_author_subject: author.subject, p_project_origin: author.projectOrigin,
    };
    const call = (overrides = {}, role = "service_role") => `SET ROLE ${role}; ${serviceClaims}
      SELECT public.pos_sync_cash_checkout_attested_v1(${Object.values({ ...args, ...overrides }).map(sqlText).join(",")});`;
    for (const role of ["anon", "authenticated"]) denySql(call({}, role), /permission denied/);
    denySql(call({ p_author_key_id: randomUUID() }), /POS_CASH_V1_AUTHOR_FORBIDDEN/);
    denySql(call({ p_author_subject: "another.cashier" }), /POS_CASH_V1_AUTHOR_FORBIDDEN/);
    denySql(call({ p_checkout_json: ` ${checkoutJson}` }), /POS_CASH_V1_CHECKOUT_DIGEST_MISMATCH/);
    denySql(call({ p_database_guid: randomUUID() }), /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
    denySql(call(), extended ? /POS_TENDER_SCOPE_FORBIDDEN/ : /POS_CASH_SETTINGS_V1_PUBLICATION_UNVERIFIED/);
    assert.equal(counts(), "0|0|0|0|0|0|10|4");
    assert.equal(sql("SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts;"), "0");
    sql(`SELECT pos_sync_feed_v1.arm_cash_settings_scope(${scope});`);
    if (extended) {
      const tamper = edit => {
        const payload = structuredClone(first);
        edit(payload);
        const p_checkout_json = JSON.stringify(payload);
        return call({ p_checkout_json, p_checkout_sha256: digest(p_checkout_json) });
      };
      denySql(tamper(payload => { delete payload.tenders.at(-1).metadata.voucher_reference; }), /POS_TENDER_INVALID/);
      denySql(tamper(payload => {
        const amount = (Number(payload.tenders.at(-1).amount) + 0.01).toFixed(2);
        payload.tenders.at(-1).amount = payload.sale.payments.at(-1).amount = amount;
      }), /POS_TENDER_INVALID/);
      assert.equal(counts(), "0|0|0|0|0|0|10|4");
      assert.equal(sql("SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts;"), "0");
    }
    const invokeRpc = body => {
      if (body !== undefined) assert.deepEqual(body, args);
      return JSON.parse(sql(call()));
    };
    const invokeRead = (rpc, values) => {
      assert(["pos_sync_pull_cash_settings_v1", "pos_sync_snapshot_cash_settings_v1", "pos_sync_cash_legacy_coverage_v1"].includes(rpc));
      const names = ["p_organization_id", "p_branch_id", "p_terminal_id", "p_binding_proof"];
      if (rpc === "pos_sync_pull_cash_settings_v1") names.push("p_epoch", "p_after_seq", "p_upper_seq", "p_limit");
      if (rpc === "pos_sync_cash_legacy_coverage_v1") names.push("p_epoch", "p_entries");
      assert.deepEqual(Object.keys(values).sort(), [...names].sort());
      return JSON.parse(sql(`${legacyRole}${serviceClaims} SELECT public.${rpc}(${names.map(name =>
        values[name] === null ? "NULL" : sqlText(name === "p_entries" ? JSON.stringify(values[name]) : String(values[name]))).join(",")});`));
    };
    const accepted = relay ? await relay({ wire, proof, args, invokeRpc, invokeRead }) : invokeRpc();
    assert.deepEqual(accepted, { status: "APPLIED", result: { sale_id: first.sale.id, scope_id: branch, epoch, seq: "1",
      operation_id: operation, terminal_id: terminal, installation_generation: installationGeneration,
      database_guid: databaseGuid, checkout_sha256: checkoutSha256, author_id: author.authorId, author_key_id: author.keyId } });
    assert.equal(sql(`SELECT cashier_id FROM public.sales WHERE id='${first.sale.id}';`), author.subject);
    assert.deepEqual(invokeRpc(), { status: "ALREADY_APPLIED", result: accepted.result });
    const settled = `1|1|${extended ? first.tenders.length : 1}|1|1|1|${10 - Number(first.item.quantity)}|4`;
    assert.equal(counts(), settled);
    const replayStock = delta => `${legacyRole}${serviceClaims}
      SELECT public.stock_apply_delta('${first.movement.id}','${product}',${sqlText(branch)},${delta});`;
    assert.equal(sql(replayStock(-Number(first.item.quantity))), String(10 - Number(first.item.quantity)));
    denySql(replayStock(1), /POS_STOCK_MOVEMENT_EVIDENCE_CONFLICT/);
    assert.equal(counts(), settled);
    const feed = JSON.parse(sql(`${legacyRole}${serviceClaims}
      SELECT public.pos_sync_pull_cash_settings_v1('default',${sqlText(branch)},'${terminal}','${proof}','${epoch}','0',NULL,10);`));
    assert.equal(feed.groups.length, 1);
    const [group] = feed.groups;
    assert.deepEqual(group.changes.map(change => change.table_name), ["sales", "sale_items", "payment_transactions",
      "item_activity_logs", ...(extended ? first.tenders.slice(1).map(() => "payment_transactions") : [])]);
    assert.equal(group.acceptance.checkout_sha256, checkoutSha256);
    if (extended) {
      const saved = JSON.parse(sql(`SELECT jsonb_build_object('payments',sale.payments,'tenders',
        (SELECT jsonb_agg(to_jsonb(tender) ORDER BY tender.client_transaction_id)
          FROM public.payment_transactions AS tender WHERE tender.sale_id=sale.id))
        FROM public.sales AS sale WHERE sale.id='${first.sale.id}';`));
      const evidence = ({ id, method, amount, metadata, client_transaction_id, reference, cashier_name }) =>
        ({ id, method, amount: Number(amount), metadata, client_transaction_id, reference, cashier_name });
      assert.deepEqual(saved.payments, first.sale.payments);
      assert.deepEqual(saved.tenders.map(evidence), first.tenders.map(evidence));
      assert.deepEqual(group.changes[0].row_data.payments, first.sale.payments);
      assert.deepEqual(group.changes.filter(change => change.table_name === "payment_transactions").map(change => evidence(change.row_data)),
        first.tenders.map(evidence));
      const archive = JSON.parse(sql(`SELECT changes FROM pos_sync_feed_v1.cash_publications
        WHERE organization_id='default' AND operation_id='${operation}';`));
      assert.deepEqual(archive, group.changes);
      await receiveExtended({ receipt: { scope_id: branch, epoch, ...group }, terminal });
    }
    sql(`UPDATE public.app_users SET permissions='{"can_process_sale":true,"page:register":false}' WHERE id='${author.authorId}';`);
    denySql(call(), /POS_CASH_V1_AUTHOR_FORBIDDEN/);
    sql(`UPDATE public.app_users SET permissions='{"can_process_sale":true}', is_active=false WHERE id='${author.authorId}';`);
    denySql(call(), /POS_CASH_V1_AUTHOR_FORBIDDEN/);
    sql(`UPDATE public.app_users SET is_active=true WHERE id='${author.authorId}';
      UPDATE pos_sync_private.shift_author_keys SET revoked_at=now() WHERE key_id='${author.keyId}';`);
    denySql(call(), /POS_CASH_V1_AUTHOR_FORBIDDEN/);
    assert.equal(counts(), settled);
    console.log(`PASS attested LocalDB ${extended ?? "cash"} to native PostgreSQL, service-only author binding, exact archived group, replay and atomic rollback`);
    return;
  }
  const firstApply = apply(operation, first, { checkoutJson, checkoutSha256 });
  const differentBytes = ` ${checkoutJson}\n`;
  const remaining = 10 - Number(first.item.quantity);
  denySql(serviceClaims + firstApply, /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  sql(`INSERT INTO pos_sync_cash_v1.installation_enrollments
    (organization_id, terminal_id, branch_id, installation_generation, database_guid)
    VALUES ('default', '${terminal}', ${sqlText(branch)}, '${installationGeneration}', '${databaseGuid}');`);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, installationGeneration: randomUUID() }), /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, databaseGuid: randomUUID() }), /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes, checkoutSha256 }), /POS_CASH_V1_CHECKOUT_DIGEST_MISMATCH/);
  denySql(serviceClaims + apply(operation, first, { checkoutJson, epoch: randomUUID() }), /POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH/);
  assert.equal(sql(`SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts;`), "0");
  assert.equal(JSON.parse(sql(serviceClaims + firstApply)).status, "WAITING_DEPENDENCY");
  assert.equal(sql(`SELECT origin_installation_id FROM pos_sync_inbox_v1.operation_receipts WHERE operation_id = '${operation}';`), installationGeneration);
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes }))), { status: "INTEGRITY_CONFLICT" });
  assert.equal(counts(), "0|0|0|0|0|0|10|4");
  sql(`INSERT INTO public.shifts (id, store_id, terminal_id, status, state) VALUES ('${shift}', ${sqlText(branch)}, '${terminal}', 'OPEN','ACTIVE');`);
  const applied = JSON.parse(sql(serviceClaims + firstApply));
  assert.deepEqual(applied, { status: "APPLIED", result: { sale_id: first.sale.id, scope_id: branch, epoch, seq: "1",
    operation_id: operation, terminal_id: terminal, installation_generation: installationGeneration,
    database_guid: databaseGuid, checkout_sha256: checkoutSha256 } });
  assert.equal(counts(), `1|1|1|1|1|1|${remaining}|4`);
  assert.deepEqual(JSON.parse(sql(serviceClaims + firstApply)), { status: "ALREADY_APPLIED", result: applied.result });
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson: differentBytes }))), { status: "INTEGRITY_CONFLICT" });
  assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson, epoch: randomUUID() }))), { status: "INTEGRITY_CONFLICT" });
  const feed = JSON.parse(sql(`SELECT pos_sync_feed_v1.pull_groups('default',${sqlText(branch)},'${epoch}','0');`));
  assert.equal(feed.groups.length, 1);
  assert.equal(feed.groups[0].operation_id, operation);
  assert.deepEqual(feed.groups[0].changes.map(entry => entry.type), ["cash_sale", "sale_item", "cash_tender", "stock_delta"]);
  assert.equal(feed.groups[0].changes[3].row.branch_balance, remaining);
  assert.equal(sql(`SELECT count(*) FROM pos_sync_cash_v1.checkout_route_owners WHERE operation_id = '${operation}';`), "7");
  await receiving?.verify({ sql, denySql, branch, epoch, terminal, shift, product, operation, first, feed });

  for (const compatible of [false, true]) {
    denySql(serviceClaims + legacyAggregate(randomUUID(), [operationRows("sale_items", [first.item])], compatible), /POS_CASH_V1_LEGACY_ROUTE_FENCED/);
    denySql(serviceClaims + legacyBatch(randomUUID(), operationRows("sales", [{ ...first.sale, id: randomUUID() }]), compatible), /POS_CASH_V1_LEGACY_ROUTE_FENCED/);
    denySql(serviceClaims + legacyBatch(randomUUID(), operationRows("stock_delta_applied", [], [
      { operation: "D", entityId: JSON.stringify({ movement_id: first.movement.id }) },
    ]), compatible), /POS_CASH_V1_LEGACY_ROUTE_FENCED/);
  }

  const verifyReenrollment = () => {
    const before = counts();
    const nextGeneration = randomUUID();
    sql(`UPDATE pos_sync_cash_v1.installation_enrollments SET installation_generation = '${nextGeneration}'
      WHERE organization_id = 'default' AND terminal_id = '${terminal}';`);
    denySql(serviceClaims + firstApply, /POS_CASH_V1_INSTALLATION_FORBIDDEN/);
    assert.deepEqual(JSON.parse(sql(serviceClaims + apply(operation, first, { checkoutJson, installationGeneration: nextGeneration }))),
      { status: "INTEGRITY_CONFLICT" });
    assert.equal(counts(), before);
  };
  if (wire) {
    assert.equal(feed.groups[0].changes[2].row.id, first.tender.id);
    verifyReenrollment();
    console.log("PASS exact SQL Server cash outbox to PostgreSQL checkout, generation-bound receipt and single-effect replay");
    return;
  }
  const changed = { ...first, sale: { ...first.sale, created_at: "2026-11-07T09:01:00Z" } };
  assert.equal(JSON.parse(sql(serviceClaims + apply(operation, changed))).status, "INTEGRITY_CONFLICT");
  assert.equal(JSON.parse(sql(serviceClaims + apply(randomUUID(), first))).status, "REVIEW_REQUIRED");
  assert.equal(counts(), "1|1|1|1|1|1|9|4");

  const next = checkout();
  const nextOperation = randomUUID();
  const extraSaleField = { ...next, sale: { ...next.sale, created_by: "unsupported" } };
  const extraPaymentField = { ...next, sale: { ...next.sale, payments: [{ ...next.sale.payments[0], reference: "unsupported" }] } };
  denySql(serviceClaims + apply(nextOperation, next, { checkoutJson: "{" }), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, extraSaleField), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, extraPaymentField), /POS_CASH_V1_INVALID_CHECKOUT/);
  denySql(serviceClaims + apply(nextOperation, next, { proof: "b".repeat(64) }), /POS_CASH_V1_SCOPE_FORBIDDEN/);
  denySql(serviceClaims + apply(nextOperation, next, { branch: "B" }), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    denySql(`SET ROLE ${role}; ${serviceClaims}${apply(nextOperation, next)}`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT * FROM pos_sync_cash_v1.installation_enrollments;`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT * FROM pos_sync_cash_v1.checkout_route_owners;`, /permission denied/);
  }
  denySql(serviceClaims + apply(nextOperation, next, { epoch: randomUUID() }), /POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH/);
  assert.equal(counts(), "1|1|1|1|1|1|9|4");
  assert.equal(sql(`SELECT count(*) FROM pos_sync_inbox_v1.operation_receipts WHERE operation_id='${nextOperation}';`), "0");
  assert.equal(sql(`SELECT count(*) FROM public.sync_idempotency_receipts WHERE batch_id='${nextOperation}';`), "0");
  assert.equal(sql(`SELECT count(*) FROM pos_sync_cash_v1.checkout_route_owners WHERE operation_id='${nextOperation}';`), "0");

  async function race(holderSql, waiterSql) {
    const holder = session();
    holder.child.stdin.write(`SET application_name = 'pos_cash_holder'; ${serviceClaims}\nBEGIN;\n${holderSql}\n\\echo POS_CASH_LOCKED\n`);
    await waitFor(() => holder.stdout.includes("POS_CASH_LOCKED"), "First cash route did not acquire its transaction lock");
    const waiter = session();
    waiter.child.stdin.end(`SET application_name = 'pos_cash_waiter'; ${serviceClaims}\n${waiterSql}\n`);
    await waitFor(() => sql(`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity AS waiter JOIN pg_stat_activity AS holder ON holder.pid = ANY(pg_blocking_pids(waiter.pid))
      WHERE waiter.application_name = 'pos_cash_waiter' AND holder.application_name = 'pos_cash_holder'
    );`) === "t", "Second cash route did not wait for the first transaction");
    holder.child.stdin.end("COMMIT;\n");
    assert.equal(await holder.finished, 0, holder.stderr);
    return { holder, waiter, waiterCode: await waiter.finished };
  }

  const legacyFirst = checkout();
  const legacyFirstOperation = randomUUID();
  const legacyWins = await race(legacyBatch(randomUUID(), operationRows("sales", [legacyFirst.sale])), apply(legacyFirstOperation, legacyFirst));
  assert.equal(legacyWins.waiterCode, 0, legacyWins.waiter.stderr);
  assert.deepEqual(JSON.parse(legacyWins.waiter.stdout.trim()), { status: "REVIEW_REQUIRED", result: { reason: "LEGACY_OR_CONFLICTING_IDENTITY" } });
  assert.equal(counts(), "2|1|1|1|1|1|9|4");

  const cashFirst = checkout();
  const unrelated = checkout();
  const cashFirstOperation = randomUUID();
  const legacyMixedBatch = randomUUID();
  const cashWins = await race(apply(cashFirstOperation, cashFirst), legacyAggregate(legacyMixedBatch, [
    operationRows("sales", [unrelated.sale]), operationRows("item_activity_logs", [cashFirst.movement]),
  ]));
  assert.notEqual(cashWins.waiterCode, 0);
  assert.match(cashWins.waiter.stderr, /POS_CASH_V1_LEGACY_ROUTE_FENCED/);
  assert.equal(JSON.parse(cashWins.holder.stdout.split(/\r?\n/)[0]).status, "APPLIED");
  assert.equal(counts(), "3|2|2|2|2|2|8|4");
  assert.equal(sql(`SELECT count(*) FROM public.sync_idempotency_receipts WHERE batch_id='${legacyMixedBatch}';`), "0");
  const unrelatedResult = JSON.parse(sql(serviceClaims + legacyAggregate(randomUUID(), [operationRows("sales", [unrelated.sale])])));
  assert.equal(unrelatedResult.ok, true);
  const beforeProtected = counts();
  sql(`CREATE SCHEMA fin62_history_preparation;
    CREATE TABLE fin62_history_preparation.streams (shift_id uuid PRIMARY KEY);
    INSERT INTO fin62_history_preparation.streams VALUES ('${shift}');`);
  denySql(serviceClaims + apply(nextOperation, next), /POS_CASH_V1_PROTECTED_SHIFT/);
  assert.equal(counts(), beforeProtected);
  verifyReenrollment();
  console.log("PASS isolated authoritative cash bridge (exact receipt, aggregate and CT batch fencing, both race orders and rollback)");
}
