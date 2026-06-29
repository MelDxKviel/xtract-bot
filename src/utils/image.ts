import { Jimp } from "jimp";

// Telegram requires static custom-emoji stickers to be exactly 100×100 px.
const EMOJI_SIZE = 100;

/**
 * Decode an arbitrary avatar image (JPEG/PNG/etc.) and re-encode it as a
 * 100×100 PNG suitable for a static custom-emoji sticker. Throws if the input
 * can't be decoded.
 */
export async function resizeToEmojiPng(input: Uint8Array): Promise<Uint8Array> {
  const image = await Jimp.read(Buffer.from(input));
  image.resize({ w: EMOJI_SIZE, h: EMOJI_SIZE });
  const png = await image.getBuffer("image/png");
  return new Uint8Array(png);
}
