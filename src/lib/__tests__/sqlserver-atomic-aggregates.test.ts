import { describe, expect, it, vi } from "vitest";

describe("SQL Server aggregate repository", () => {
  it("retries only confirmed deadlock rollbacks with the same operation", async () => {
    const { AggregateRepository } = await import("../../../electron/db/repositories/aggregates.cjs");
    const repository = new AggregateRepository({},{});
    const aggregate = {operationId:"11111111-1111-4111-8111-111111111111",operations:[]};
    const write = vi.spyOn(repository,"commitOnce")
      .mockRejectedValueOnce(Object.assign(new Error("deadlock"),{sqlNumber:1205}))
      .mockResolvedValueOnce({ok:true});
    await expect(repository.commit("held_order",aggregate)).resolves.toMatchObject({ok:true});
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.every(call=>call[1]===aggregate)).toBe(true);
    write.mockReset().mockRejectedValue(Object.assign(new Error("timeout"),{code:"ETIMEOUT"}));
    await expect(repository.commit("held_order",aggregate)).rejects.toThrow("timeout");
    expect(write).toHaveBeenCalledOnce();
  });
  it("rolls back fully when any aggregate statement fails", async () => {
    const rollback = vi.fn();
    const commit = vi.fn();
    class Transaction {
      begin = vi.fn();
      rollback = rollback;
      commit = commit;
    }
    class Request {
      input() {
        return this;
      }
      query() {
        return { recordset: [] };
      }
    }
    const sql = {
      Transaction,
      Request,
      UniqueIdentifier: "uuid",
      ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    };
    const { AggregateRepository } =
      await import("../../../electron/db/repositories/aggregates.cjs");
    const operations = {
      pool: () => ({}),
      tables: new Map([
        [
          "sales",
          { sqlServerTable: "sales", columns: [{ sqlServerColumn: "id", primaryKey: true }] },
        ],
      ]),
      validate: (value: unknown) => value,
      applyOperation: vi.fn().mockRejectedValue(new Error("injected statement failure")),
    };
    const repository = new AggregateRepository({ sql: () => sql }, operations);
    const committed = repository.commit("sale", {
        operationId: "11111111-1111-4111-8111-111111111111",
        operations: [
          {
            kind: "insert",
            table: "sales",
            rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
          },
        ],
      });
    await expect(committed).rejects.toMatchObject({
      code: "ESQLSERVER_WRITE",
      table: "sales",
      message: "Local SQL Server sale commit failed while writing sales.",
    });
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rolls back the sale header when a later payment row fails", async () => {
    const rollback = vi.fn();
    const commit = vi.fn();
    class Transaction {
      begin = vi.fn();
      rollback = rollback;
      commit = commit;
    }
    class Request {
      input() {
        return this;
      }
      query() {
        return { recordset: [] };
      }
    }
    const sql = {
      Transaction,
      Request,
      UniqueIdentifier: "uuid",
      ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    };
    const tables = new Map([
      [
        "sales",
        { sqlServerTable: "sales", columns: [{ sqlServerColumn: "id", primaryKey: true }] },
      ],
      [
        "payment_transactions",
        {
          sqlServerTable: "payment_transactions",
          columns: [{ sqlServerColumn: "id", primaryKey: true }],
        },
      ],
    ]);
    const applyOperation = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("payment insert failed"));
    const operations = {
      pool: () => ({}),
      tables,
      validate: (value: unknown) => value,
      applyOperation,
    };
    const { AggregateRepository } =
      await import("../../../electron/db/repositories/aggregates.cjs");
    const repository = new AggregateRepository({ sql: () => sql }, operations);
    const committed = repository.commit("sale", {
        operationId: "11111111-1111-4111-8111-111111111111",
        operations: [
          {
            kind: "upsert",
            table: "sales",
            rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
          },
          {
            kind: "upsert",
            table: "payment_transactions",
            rows: [{ id: "33333333-3333-4333-8333-333333333333" }],
          },
        ],
      });
    await expect(committed).rejects.toMatchObject({
      code: "ESQLSERVER_WRITE",
      table: "payment_transactions",
      message: "Local SQL Server sale commit failed while writing payment_transactions.",
    });
    expect(applyOperation).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("refuses arbitrary procedure names", async () => {
    const { AggregateRepository } =
      await import("../../../electron/db/repositories/aggregates.cjs");
    await expect(
      new AggregateRepository({}, {}).commit("runSql", { operations: [] }),
    ).rejects.toThrow("Unsupported");
  });

  it("rolls back an exchange when the original bill cannot be claimed", async () => {
    const rollback = vi.fn();
    const commit = vi.fn();
    class Transaction {
      begin = vi.fn();
      rollback = rollback;
      commit = commit;
    }
    class Request {
      input() {
        return this;
      }
      query() {
        return { recordset: [] };
      }
    }
    const sql = {
      Transaction,
      Request,
      UniqueIdentifier: "uuid",
      ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    };
    const operations = {
      pool: () => ({}),
      tables: new Map([
        [
          "sales",
          { sqlServerTable: "sales", columns: [{ sqlServerColumn: "id", primaryKey: true }] },
        ],
      ]),
      validate: (value: unknown) => value,
      applyOperation: vi.fn().mockResolvedValue(0),
    };
    const { AggregateRepository } =
      await import("../../../electron/db/repositories/aggregates.cjs");
    const repository = new AggregateRepository({ sql: () => sql }, operations);

    await expect(
      repository.commit("sale", {
        operationId: "11111111-1111-4111-8111-111111111111",
        branchId: "B1",
        operations: [
          {
            kind: "update",
            table: "sales",
            values: { exchanged_to_bill_number: "NEW-1" },
            match: { id: "22222222-2222-4222-8222-222222222222" },
            requireMatch: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "EEXCHANGE_STATE" });
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("replays the same aggregate without applying business statements twice", async () => {
    let receipt: string | null = null;
    class Transaction {
      async begin() {}
      async commit() {}
      async rollback() {}
    }
    class Request {
      values: Record<string, unknown> = {};
      input(name: string, ...args: unknown[]) {
        this.values[name] = args.at(-1);
        return this;
      }
      async query(text: string) {
        if (text.startsWith("SELECT note"))
          return { recordset: receipt ? [{ note: receipt }] : [] };
        if (text.startsWith("INSERT dbo.local_operation_receipts"))
          receipt = String(this.values.note);
        return { recordset: [] };
      }
    }
    const sql = {
      Transaction,
      Request,
      UniqueIdentifier: "uuid",
      ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    };
    const applyOperation = vi.fn().mockResolvedValue(1);
    const operations = {
      pool: () => ({}),
      tables: new Map([
        [
          "sales",
          { sqlServerTable: "sales", columns: [{ sqlServerColumn: "id", primaryKey: true }] },
        ],
      ]),
      validate: (value: unknown) => value,
      applyOperation,
    };
    const { AggregateRepository } =
      await import("../../../electron/db/repositories/aggregates.cjs");
    const repository = new AggregateRepository({ sql: () => sql }, operations);
    const aggregate = {
      operationId: "11111111-1111-4111-8111-111111111111",
      branchId: "B1",
      operations: [
        {
          kind: "insert",
          table: "sales",
          rows: [{ id: "22222222-2222-4222-8222-222222222222", store_id: "B1" }],
        },
      ],
    };
    await expect(repository.commit("sale", aggregate)).resolves.toMatchObject({ replayed: false });
    await expect(repository.commit("sale", aggregate)).resolves.toMatchObject({ replayed: true });
    expect(applyOperation).toHaveBeenCalledOnce();
  });
});
