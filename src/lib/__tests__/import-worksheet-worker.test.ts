import * as XLSX from "xlsx";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
const messages: Array<{ type: string; names?: string[]; rows?: Record<string, unknown>[] }> = [];
const worker = { onmessage: null as unknown as (event: { data: unknown }) => void, postMessage: (message: typeof messages[number]) => messages.push(message) };
beforeAll(async () => {
  vi.stubGlobal("self", worker);
  await import("@/platforms/web/components/pos/product-import.worker");
});
beforeEach(() => { messages.length = 0; });
afterAll(() => vi.unstubAllGlobals());
it("waits for a sheet choice and parses only the selected rows with original decimal precision", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ barcode: "wrong", cost: 1 }]), "Instructions");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ barcode: "right", cost: 12.3456 }]), "Purchased items");
  worker.onmessage({ data: { name: "purchase.xlsx", buffer: XLSX.write(book, { type: "array", bookType: "xlsx" }) } });
  expect(messages.find(message => message.type === "sheets")?.names).toEqual(["Instructions", "Purchased items"]);
  expect(messages.some(message => message.type === "rows")).toBe(false);
  worker.onmessage({ data: { sheetName: "Purchased items" } });
  expect(messages.flatMap(message => message.rows ?? [])).toEqual([{ barcode: "right", cost: 12.3456 }]);
});
it("preserves CSV codes and decimal-comma text rather than guessing and rounding it", () => {
  worker.onmessage({ data: { name: "products.csv", buffer: new TextEncoder().encode('barcode,cost\n00123,"12,50"').buffer } });
  expect(messages.flatMap(message => message.rows ?? [])).toEqual([{ barcode: "00123", cost: "12,50" }]);
});
it("rejects a sheet not present in the workbook without returning rows", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["name"], ["a"]]), "A");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["name"], ["b"]]), "B");
  worker.onmessage({ data: { name: "file.xlsx", buffer: XLSX.write(book, { type: "array", bookType: "xlsx" }) } });
  worker.onmessage({ data: { sheetName: "missing" } });
  expect(messages.some(message => message.type === "error")).toBe(true);
  expect(messages.some(message => message.type === "rows")).toBe(false);
});
