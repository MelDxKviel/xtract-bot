import { Jimp } from "jimp";
import { describe, expect, it } from "vitest";

import { resizeToEmojiPng } from "@/utils/image";

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const image = new Jimp({ width, height, color: 0x112233ff });
  return new Uint8Array(await image.getBuffer("image/png"));
}

describe("resizeToEmojiPng", () => {
  it("resizes any source to a 100x100 PNG", async () => {
    const out = await resizeToEmojiPng(await makePng(400, 250));
    const decoded = await Jimp.read(Buffer.from(out));
    expect(decoded.bitmap.width).toBe(100);
    expect(decoded.bitmap.height).toBe(100);
  });

  it("stays well under Telegram's 64KB sticker limit", async () => {
    const out = await resizeToEmojiPng(await makePng(512, 512));
    expect(out.byteLength).toBeLessThanOrEqual(64 * 1024);
  });

  it("rejects input it cannot decode", async () => {
    await expect(resizeToEmojiPng(new Uint8Array([0, 1, 2, 3]))).rejects.toBeInstanceOf(Error);
  });
});
