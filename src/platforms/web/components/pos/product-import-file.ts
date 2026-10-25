export type ImportFileProgress = { percent: number; label: string };

type WorkerMessage =
  | { type: "sheets"; names: string[] }
  | { type: "progress"; percent: number; label: string }
  | { type: "rows"; rows: Record<string, unknown>[] }
  | { type: "complete"; total: number }
  | { type: "error"; message: string };

/** Parse spreadsheets away from React's thread and transfer results in bounded chunks. */
export async function parseProductImportFile(
  file: File,
  onProgress?: (progress: ImportFileProgress) => void,
  chooseWorksheet?: (names: string[]) => Promise<string | null>,
): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./product-import.worker.ts", import.meta.url), {
      type: "module",
      name: "product-import-parser",
    });
    const rows: Record<string, unknown>[] = [];
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "sheets") {
        void (async () => {
          try {
            const name = chooseWorksheet ? await chooseWorksheet(message.names) : message.names[0];
            if (!name) throw new DOMException("Worksheet selection cancelled", "AbortError");
            if (!message.names.includes(name)) throw new Error("Choose a worksheet from this workbook");
            worker.postMessage({ sheetName: name });
          } catch (error) { worker.terminate(); reject(error); }
        })();
      }
      if (message.type === "progress") onProgress?.(message);
      if (message.type === "rows") rows.push(...message.rows);
      if (message.type === "complete") {
        worker.terminate();
        resolve(rows);
      }
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Spreadsheet worker failed"));
    };
    worker.postMessage({ name: file.name, buffer }, [buffer]);
  });
}
