import { getFetch, withTimeout, type FetchLike } from "@/providers/http";

const MAX_BYTES = 3072;

/** A widget cannot access the network. Fetch only a tiny, trusted CDN avatar. */
export async function loadWidgetAvatar(
  value: string | null | undefined,
  fetch?: FetchLike,
): Promise<string | null> {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "pbs.twimg.com" ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/profile_images/")
  )
    return null;
  url.pathname = url.pathname.replace(
    /(?:_(?:normal|bigger|400x400|mini))?(\.[a-z]+)$/i,
    "_mini$1",
  );
  const { signal, clear } = withTimeout(2000);
  try {
    const response = await getFetch(fetch)(url.toString(), { signal, redirect: "error" });
    if (!response.ok || !response.body) return null;
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        length += chunk.byteLength;
        if (length > MAX_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const data = Buffer.concat(chunks);
    const mime =
      data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        ? "jpeg"
        : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "png"
          : /^GIF8[79]a/.test(data.subarray(0, 6).toString())
            ? "gif"
            : data.subarray(0, 4).toString() === "RIFF" &&
                data.subarray(8, 12).toString() === "WEBP"
              ? "webp"
              : null;
    return mime ? `data:image/${mime};base64,${data.toString("base64")}` : null;
  } catch {
    return null;
  } finally {
    clear();
  }
}
