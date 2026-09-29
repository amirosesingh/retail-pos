import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("local-first authorization rules", () => {
  it("commits the rule and immutable history inside one SQL Server transaction", () => {
    const repository = source("electron/db/repositories/authorization-rules.cjs");
    expect(repository).toContain("SERIALIZABLE");
    expect(repository).toContain("WITH (UPDLOCK,HOLDLOCK)");
    expect(repository).toContain("expected_version");
    expect(repository).toContain("ESTALE_RULE");
    expect(repository).toContain("INSERT dbo.authorization_action_history");
    expect(repository).toContain("await transaction.commit()");
  });

  it("requires a verified POS settings identity at both desktop and hosted boundaries", () => {
    const main = source("electron/main.cjs");
    const privilege = source("electron/ipc-privilege.cjs");
    const endpoint = source("src/lib/sync-endpoint.server.ts");
    expect(main).toContain('ipcMain.handle("business:save-authorization-rule"');
    expect(main).toContain('adminSession.hasPermission("can_access_pos_settings")');
    expect(privilege).toContain('channel === "business:save-authorization-rule"');
    expect(endpoint).toContain('code:"GOVERNANCE_AUTH_REQUIRED"');
    expect(endpoint).toContain("scope.kind === \"terminal\"");
  });

  it("uses versioned cloud merge and never routes the Electron save through the browser outbox", () => {
    const schema = source("supabase/schema.sql");
    const client = source("src/lib/authorization-client.ts");
    expect(schema).toMatch(/authorization_actions[\s\S]*row_version integer NOT NULL DEFAULT 1/);
    expect(schema).toContain('(EXCLUDED."row_version",EXCLUDED."updated_at",COALESCE(EXCLUDED."updated_by",\'\'))>');
    expect(schema).toContain("authorization_action_history is insert-only");
    expect(client).toContain("localDb()!.saveAuthorizationRule!");
    expect(client).not.toContain("sync-outbox");
  });
});
