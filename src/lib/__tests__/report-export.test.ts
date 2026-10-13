import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { reportWorksheet } from "../report-export";

describe("readable Excel reports", () => {
  it("round trips amounts as numbers and identifiers/formula-like messages as text", async () => {
    const rows = [["Receipt", "Total", "Message"], ["00123", 12.5, "=HYPERLINK(\"example\")"]];
    const sheet = await reportWorksheet(rows);
    expect(sheet.A2).toMatchObject({ t: "s", v: "00123" });
    expect(sheet.B2).toMatchObject({ t: "n", v: 12.5, z: "#,##0.00" });
    expect(sheet.C2.t).toBe("s");
    expect(sheet.C2.f).toBeUndefined();
    expect(sheet["!autofilter"]?.ref).toBe("A1:C2");
    expect(sheet["!cols"]?.every(column => (column.wch ?? 0) >= 14)).toBe(true);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Report");
    const restored = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(restored.Sheets.Report, { header: 1 })).toEqual(rows);
  });
});
