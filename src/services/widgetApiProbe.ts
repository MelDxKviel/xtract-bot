import { getFetch, withTimeout, type FetchLike } from "@/providers/http";

export interface WidgetApiProbe {
  available: boolean;
  errorCode: number;
  description: string;
}

/** Probe with an invalid chat: no user receives a message. */
export async function probeWidgetApi(token: string, fetch?: FetchLike): Promise<WidgetApiProbe> {
  const { signal, clear } = withTimeout(10000);
  try {
    const response = await getFetch(fetch)(`https://api.telegram.org/bot${token}/sendWidget`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 0, html: "<p>Xtract widget capability check</p>" }),
    });
    const result = (await response.json()) as { error_code?: number; description?: string };
    const description = String(result.description ?? "")
      .replaceAll(token, "[redacted]")
      .slice(0, 200);
    return {
      available: result.error_code === 400 && /chat not found|chat_id is empty/i.test(description),
      errorCode: Number(result.error_code ?? response.status),
      description,
    };
  } finally {
    clear();
  }
}

if (import.meta.main) {
  const token = process.env["BOT_TOKEN"];
  if (!token) throw new Error("BOT_TOKEN is required");
  try {
    const probe = await probeWidgetApi(token);
    console.log(JSON.stringify({ event: "widget_api_probe", ...probe }));
  } catch {
    console.error("widget_api_probe failed without receiving a Telegram response");
    process.exitCode = 1;
  }
}
