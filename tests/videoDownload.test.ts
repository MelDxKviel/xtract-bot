import { InputFile } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadVideo } from "@/services/videoDownload";

const VIDEO_URL = "https://video.twimg.com/video.mp4";

afterEach(() => vi.useRealTimers());

describe("video download for Telegram upload", () => {
  it("creates an MP4 upload from the downloaded bytes", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "video/mp4" },
        }),
    );
    const file = await downloadVideo(VIDEO_URL, fetch);
    expect(file).toBeInstanceOf(InputFile);
    expect(file.filename).toBe("video.mp4");
    expect(fetch).toHaveBeenCalledWith(
      VIDEO_URL,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it.each(["image/jpeg", "text/html", "application/json"])(
    "rejects %s instead of uploading a poster or error page",
    async (contentType) => {
      await expect(
        downloadVideo(
          VIDEO_URL,
          async () =>
            new Response("bad", {
              headers: { "content-type": contentType },
            }),
        ),
      ).rejects.toThrow("video download rejected");
    },
  );

  it("rejects unsuccessful responses", async () => {
    await expect(
      downloadVideo(VIDEO_URL, async () => new Response(null, { status: 403 })),
    ).rejects.toThrow("HTTP 403");
  });

  it("rejects empty downloads", async () => {
    await expect(
      downloadVideo(VIDEO_URL, async () => new Response(new Uint8Array())),
    ).rejects.toThrow("empty video");
  });

  it("rejects videos larger than the upload limit before reading them", async () => {
    await expect(
      downloadVideo(
        VIDEO_URL,
        async () =>
          new Response("unused", {
            headers: { "content-length": "50000001" },
          }),
      ),
    ).rejects.toThrow("video download rejected");
  });

  it("enforces the size limit for streams without Content-Length", async () => {
    const chunk = new Uint8Array(25_000_001);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(downloadVideo(VIDEO_URL, async () => new Response(body))).rejects.toThrow(
      "size limit",
    );
    expect(cancelled).toBe(true);
  });

  it("keeps the timeout active while reading the response body", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init!.signal!.addEventListener(
                "abort",
                () => controller.error(new Error("aborted")),
                { once: true },
              );
            },
          }),
        ),
    );
    const result = expect(downloadVideo(VIDEO_URL, fetch)).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
  });

  it.each([
    "http://video.twimg.com/video.mp4",
    "https://example.com/video.mp4",
    "https://video.twimg.com.example.com/video.mp4",
  ])("does not download unsupported URL %s", async (url) => {
    const fetch = vi.fn();
    await expect(downloadVideo(url, fetch)).rejects.toThrow("unsupported video download host");
    expect(fetch).not.toHaveBeenCalled();
  });
});
