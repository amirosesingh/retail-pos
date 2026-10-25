/// <reference lib="webworker" />

import * as XLSX from "xlsx";

type ParseRequest = { name: string; buffer: ArrayBuffer } | { sheetName: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let workbook: XLSX.WorkBook | null = null;
let fileName = "";

ctx.onmessage = (event: MessageEvent<ParseRequest>) => {
  try {
    ctx.postMessage({ type: "progress", percent: 10, label: "Reading the file…" });
    if ("buffer" in event.data) {
      workbook = XLSX.read(event.data.buffer, { type: "array", dense: true, raw: true });
      fileName = event.data.name;
      if (workbook.SheetNames.length > 1) {
        ctx.postMessage({ type: "sheets", names: workbook.SheetNames });
        return;
      }
    }
    const selected = "sheetName" in event.data ? event.data.sheetName : workbook?.SheetNames[0];
    const sheet = selected && workbook?.SheetNames.includes(selected) ? workbook.Sheets[selected] : undefined;
    if (!sheet) throw new Error("The workbook does not contain a worksheet");

    ctx.postMessage({ type: "progress", percent: 45, label: "Reading spreadsheet rows…" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const chunkSize = 5_000;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const end = Math.min(rows.length, offset + chunkSize);
      ctx.postMessage({ type: "rows", rows: rows.slice(offset, end) });
      ctx.postMessage({
        type: "progress",
        percent: 45 + Math.round((end / Math.max(1, rows.length)) * 55),
        label: `Prepared ${end.toLocaleString()} of ${rows.length.toLocaleString()} rows…`,
      });
    }
    ctx.postMessage({ type: "complete", total: rows.length, fileName });
    workbook = null;
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Could not read the spreadsheet",
    });
  }
};

export {};
