import { InputFile } from "grammy";

import { getFetch, withTimeout, type FetchLike } from "@/providers/http";

// Telegram accepts larger videos as uploads than it does when fetching a URL.
const MAX_VIDEO_BYTES = 50_000_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export async function downloadVideo(url: string, fetch?: FetchLike): Promise<InputFile> {
  const source = new URL(url);
  // This retry downloads X media only; never follow redirects to arbitrary hosts.
  if (source.protocol !== "https:" || source.hostname !== "video.twimg.com") {
    throw new Error("unsupported video download host");
  }

  const { signal, clear } = withTimeout(DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await getFetch(fetch)(url, { signal, redirect: "error" });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const contentLength = Number(response.headers.get("content-length"));
    if (
      !response.ok ||
      !response.body ||
      contentLength > MAX_VIDEO_BYTES ||
      (contentType && contentType !== "video/mp4" && contentType !== "application/octet-stream")
    ) {
      await response.body?.cancel();
      throw new Error(`video download rejected: HTTP ${response.status}, type=${contentType}`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_VIDEO_BYTES) throw new Error("video exceeds upload size limit");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (size === 0) throw new Error("empty video download");
    return new InputFile(Buffer.concat(chunks, size), "video.mp4");
  } finally {
    clear();
  }
}
