import { registerPlugin } from "@capacitor/core";

export type UpdateDownload = {
  status: "idle" | "downloading" | "paused" | "complete" | "failed";
  url?: string;
  file?: string;
  bytes?: number;
  total?: number;
  uri?: string;
  error?: string;
};

const downloader = registerPlugin<{
  start(options: { url: string; file: string }): Promise<UpdateDownload>;
  status(): Promise<UpdateDownload>;
}>("PosUpdateDownload");

export const readUpdateDownload = () => downloader.status();
export const startUpdateDownload = (url: string, file: string) => downloader.start({ url, file });
export function downloadPercent(download: UpdateDownload) {
  return download.status === "complete" ? 100 : download.total && download.total > 0
    ? Math.min(99, Math.floor((download.bytes ?? 0) / download.total * 100)) : 0;
}

/** Poll only observes Android's job; suspending this JS never stops the download. */
export async function waitForUpdateDownload(url: string, file: string, onProgress: (percent: number) => void) {
  let download = await startUpdateDownload(url, file);
  for (;;) {
    if (download.url !== url || download.file !== file) throw new Error("The selected update download has changed.");
    onProgress(downloadPercent(download));
    if (download.status === "complete" && download.uri) return download.uri;
    if (download.status === "failed" || download.status === "idle") throw new Error(download.error ?? "The update download was removed. Tap Download to retry.");
    await new Promise(resolve => setTimeout(resolve, 1000));
    download = await readUpdateDownload();
  }
}
