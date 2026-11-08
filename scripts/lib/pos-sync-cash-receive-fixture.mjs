import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const literal = value => `'${value.replaceAll("'", "''")}'`;
const organization = "isolated-cash-receiving";

export async function cashReceivingFixture(root) {
  const projection = await readFile(new URL("../preparation/pos-sync-cash-receive-v1.sql", import.meta.url), "utf8");
  return {
    prepare({ sql, denySql, branch, epoch }) {
      // Only the fixture installs a bridge-to-receiver publisher. It captures
      // complete persisted rows before the sender transaction can commit.
      sql(`BEGIN;
        ${projection}
        INSERT INTO pos_sync_feed_v1.feed_heads (organization_id,scope_id,epoch)
        VALUES ('${organization}',${literal(branch)},'${epoch}');
        CREATE FUNCTION pos_sync_cash_v1.fixture_publish_receipt() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog AS $$
        BEGIN
          PERFORM pos_sync_feed_v1.append_groups('${organization}',jsonb_build_array(jsonb_build_object(
            'scope_id',NEW.scope_id,'epoch',NEW.epoch,'operation_id',NEW.operation_id,
            'changes',pos_sync_cash_v1.project_receipt(NEW.scope_id,NEW.changes))));
          RETURN NULL;
        END $$;
        CREATE TRIGGER fixture_publish_receipt AFTER INSERT ON pos_sync_feed_v1.feed_groups
        FOR EACH ROW WHEN (NEW.organization_id = 'default' AND NEW.operation_id IS NOT NULL AND NEW.changes->0->>'type' = 'cash_sale')
        EXECUTE FUNCTION pos_sync_cash_v1.fixture_publish_receipt();
        COMMIT;`);
      denySql(`SET ROLE service_role; SELECT pos_sync_cash_v1.project_receipt(${literal(branch)},'[]');`, /permission denied/);
    },
    verify({ sql, denySql, branch, epoch, operation, terminal, feed }) {
      const group = JSON.parse(sql(`SELECT pos_sync_feed_v1.pull_groups('${organization}',${literal(branch)},'${epoch}','0');`));
      assert.equal(group.status, "OK");
      assert.equal(group.next_seq, "1");
      assert.equal(group.has_more, false);
      assert.equal(group.groups.length, 1);
      assert.equal(group.groups[0].operation_id, operation);
      const source = literal(JSON.stringify(feed.groups[0].changes));
      denySql(`SELECT pos_sync_cash_v1.project_receipt('outside-fixture',${source});`, /POS_CASH_V1_RECEIPT_PROJECTION_UNAVAILABLE/);
      const receipt = { scope_id: branch, epoch, ...group.groups[0] };
      const output = execFileSync(process.execPath, [join(root, "scripts/test-pos-sync-cash-receive-sqlserver.cjs"), "--run"], {
        cwd: root, windowsHide: true, encoding: "utf8", input: JSON.stringify({ receipt, terminal }), timeout: 120_000,
      });
      console.log(output.trim());
    },
  };
}
