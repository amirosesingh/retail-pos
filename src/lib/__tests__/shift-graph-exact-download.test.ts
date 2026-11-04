import { describe, expect, it } from "vitest";
import { exactShiftGraphDownload, exactShiftGraphJson } from "../shift-graph-exact-download.server";
import { withCors } from "../public-cors";
import { redactSyncDownload } from "../sync-download-redaction";

const graph = (row: string) =>
  `{"ok":true,"shiftGraphVersion":1,"tables":[{"table":"shift_close_events","rows":[${row}]}]}`;
describe("graph-only lossless server privacy projection", () => {
  it("preserves the exact capability through the existing CORS wrapper only on success", async () => {
    const request = new Request("https://pos.fixture/api/v1/pos/sync", {
      headers: { origin: "http://localhost" },
    });
    const response = withCors(
      await exactShiftGraphDownload(new Response(graph('{"amount":1.000000000000000001}')), false),
      request,
    );
    expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBe("1");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
    expect(await response.text()).toContain("1.000000000000000001");
    const invalid = withCors(
      await exactShiftGraphDownload(new Response("malformed"), false),
      request,
    );
    expect(invalid.status).toBe(502);
    expect(invalid.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
  });
  it.each([false, true])(
    "preserves numeric lexemes and all existing privacy decisions commerce=%s",
    (management) => {
      const raw = graph(
        '{"amount":648.00000000000000000001,"integer":900719925474099312345,"negative":-0,"exponent":1.234567890123456789e-20,"nested":{"ordinary":{"raw":"648.00000000000000000001","marker":"__RAW_NUMBER_0__"},"product":{"table_name":"products","ecom_price":1.001,"price":12.0000000000000000001},"terminal":{"table_name":"terminal_tokens","claim_proof":"secret","status":"used"},"ecommerceEnabled":true}}',
      );
      const text = exactShiftGraphJson(raw, management);
      expect(text).toContain('"amount":648.00000000000000000001');
      expect(text).toContain('"integer":900719925474099312345');
      expect(text).toContain('"negative":-0');
      expect(text).toContain('"exponent":1.234567890123456789e-20');
      expect(text).not.toContain('"secret"');
      expect(text).toContain('"raw":"648.00000000000000000001"');
      expect(text).toContain('"marker":"__RAW_NUMBER_0__"');
      const parsed = JSON.parse(raw);
      const { tables, ...envelope } = parsed;
      const expected = {
        ...(redactSyncDownload(envelope, "", management) as object),
        tables: tables.map((part: { table: string }) =>
          redactSyncDownload(part, part.table, management),
        ),
      };
      expect(JSON.parse(text)).toEqual(expected);
      expect(text.includes('"ecom_price"')).toBe(management);
    },
  );
  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\u0061":2}',
    '{"a":01}',
    '{"a":1e}',
    '{"a":NaN}',
    '{"a":Infinity}',
    '{"a":1}tail',
    '{"a":"unterminated}',
    "[]",
    "null",
  ])("fails closed on malformed or ambiguous input %s", (raw) => {
    expect(() => exactShiftGraphJson(raw, false)).toThrow();
  });
  it("accepts the full six-MiB table graph plus bounded RPC envelope without truncation", () => {
    const head = '[{"table":"shifts","rows":[{"note":"',
      tail = '"}]}]';
    const tables = head + "x".repeat(6 * 1024 * 1024 - head.length - tail.length) + tail;
    const text = exactShiftGraphJson('{"graphToken":"opaque","tables":' + tables + "}", false);
    expect(text.length).toBeGreaterThan(6 * 1024 * 1024);
    expect(JSON.parse(text).tables[0].rows[0].note.length).toBe(
      6 * 1024 * 1024 - head.length - tail.length,
    );
    expect(() =>
      exactShiftGraphJson('{"graphToken":"' + "x".repeat(16 * 1024) + '","tables":[]}', false),
    ).toThrow();
    expect(() =>
      exactShiftGraphJson(
        '{"tables":' +
          head +
          "x".repeat(6 * 1024 * 1024 - head.length - tail.length + 1) +
          tail +
          "}",
        false,
      ),
    ).toThrow();
  });
  it("rejects oversized, excessively deep and over-2000-row graphs", () => {
    expect(() =>
      exactShiftGraphJson(graph(`{"note":"${"x".repeat(6 * 1024 * 1024)}"}`), false),
    ).toThrow();
    expect(() =>
      exactShiftGraphJson(graph(`{"nested":${"[".repeat(129)}0${"]".repeat(129)}}`), false),
    ).toThrow();
    expect(() =>
      exactShiftGraphJson(
        `{"tables":[{"table":"shifts","rows":[${Array(2001).fill("{}").join(",")}]}]}`,
        false,
      ),
    ).toThrow();
  });
  it("preserves strings resembling numeric brands, __proto__ and unusual settings array semantics", () => {
    const raw =
      '{"tables":[{"table":"settings_scoped","rows":[{"key":"product_price:p","value":[12.1234567890123456789,{"raw":"1.0","ecommerceEnabled":true}]}]},{"table":"shifts","rows":[{"__proto__":{"raw":"99"},"raw":"1e999999","note":"\\u0031"}]}]}';
    const text = exactShiftGraphJson(raw, false);
    expect(text).toContain("12.1234567890123456789");
    expect(text).toContain('"raw":"1.0"');
    expect(text).toContain('"__proto__"');
    expect(text).not.toContain("ecommerceEnabled");
    expect(JSON.parse(text).tables[0].rows[0].value).not.toBeInstanceOf(Array);
  });
  it("retains numeric product_price settings as numbers rather than exposing token implementation", () => {
    const raw =
      '{"tables":[{"table":"settings_scoped","rows":[{"key":"product_price:p","value":1.00000000000000000001}]}]}';
    expect(exactShiftGraphJson(raw, false)).toContain('"value":1.00000000000000000001');
    expect(exactShiftGraphJson(raw, false)).not.toContain('"raw"');
  });
  it("bounds actual streamed bytes even without trustworthy Content-Length and cancels failed streams", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await exactShiftGraphDownload(
      new Response(stream, { headers: { "content-length": "1" } }),
      false,
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
    expect(await response.json()).toMatchObject({ code: "ESHIFT_GRAPH_PROTOCOL" });
    expect(cancelled).toBe(true);
  });
  it("returns bounded generic errors without exposing upstream data or malformed UTF8", async () => {
    for (const input of [new Response("private malformed"), new Response(new Uint8Array([0xff]))]) {
      const response = await exactShiftGraphDownload(input, false);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("private malformed");
    }
  });
  it("preserves non-graph and error envelopes without advertising recovery precision capability", async () => {
    for (const text of ['{"ok":false,"error":"Not found","tables":[]}', '{"ok":true}']) {
      const response = await exactShiftGraphDownload(new Response(text), false);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(text);
      expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
    }
  });
  it("bounds optional exact proofs by actual UTF8 body bytes while downloading every ordinary row", async () => {
    const base = graph('{"amount":648.00000000000000000001,"padding":""}');
    for (const bytes of [32 * 1024, 32 * 1024 + 1]) {
      const raw = base.replace(
        '"padding":""',
        '"padding":"' + "x".repeat(bytes - base.length) + '"',
      );
      const response = await exactShiftGraphDownload(new Response(raw), false);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBe(bytes <= 32 * 1024 ? "1" : null);
      const text = await response.text();
      expect(text.includes("648.00000000000000000001")).toBe(bytes <= 32 * 1024);
      expect(JSON.parse(text).tables[0].rows[0].padding.length).toBe(bytes - base.length);
    }
    const raw = graph(
      '{"amount":648.00000000000000000001,"padding":"' +
        "é".repeat(17000) +
        '","X-POS-Shift-Graph-Exact":true}',
    );
    expect(raw.length).toBeLessThan(32 * 1024);
    const response = await exactShiftGraphDownload(new Response(raw), false);
    expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
    expect(JSON.parse(await response.text()).tables[0].rows[0].padding).toHaveLength(17000);
  });
  it("retains full legacy privacy parity and guards on the large ordinary fallback", async () => {
    const raw = graph(
      '{"amount":648.00000000000000000001,"padding":"' +
        "x".repeat(33000) +
        '","nested":{"table_name":"terminal_tokens","claim_proof":"private","status":"used"}}',
    );
    const response = await exactShiftGraphDownload(new Response(raw), false);
    const parsed = JSON.parse(raw);
    const { tables, ...envelope } = parsed;
    const expected = {
      ...(redactSyncDownload(envelope, "", false) as object),
      tables: tables.map((part: { table: string }) => redactSyncDownload(part, part.table, false)),
    };
    expect(await response.text()).toBe(JSON.stringify(expected));
    expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
    const invalid =
      '{ "padding":"' +
      "x".repeat(33000) +
      '","tables":[{"table":"shifts","rows":[' +
      Array(2001).fill("{}").join(",") +
      "]}]}";
    expect((await exactShiftGraphDownload(new Response(invalid), false)).status).toBe(502);
  });
  it.each(["1e400", "-1e400", "-0", "-1e-400"])(
    "preserves legacy ordinary numeric semantics without claiming exact proof for %s",
    async (literal) => {
      const raw = graph(
        '{"amount":' +
          literal +
          ',"numericString":"' +
          literal +
          '","terminal":{"table_name":"terminal_tokens","claim_proof":"private","status":"used"}}',
      );
      const response = await exactShiftGraphDownload(new Response(raw), false);
      expect(response.status).toBe(200);
      expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBeNull();
      const parsed = JSON.parse(raw);
      const { tables, ...envelope } = parsed;
      const expected = {
        ...(redactSyncDownload(envelope, "", false) as object),
        tables: tables.map((part: { table: string }) =>
          redactSyncDownload(part, part.table, false),
        ),
      };
      expect(await response.text()).toBe(JSON.stringify(expected));
    },
  );
  it("uses the existing output envelope and no numeric placeholders", async () => {
    const response = await exactShiftGraphDownload(
      new Response(graph('{"amount":1.000000000000000001}')),
      false,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-POS-Shift-Graph-Exact")).toBe("1");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toContain('"amount":1.000000000000000001');
  });
});
