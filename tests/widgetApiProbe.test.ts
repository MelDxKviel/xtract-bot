import { describe, expect, it, vi } from "vitest";
import { probeWidgetApi } from "@/services/widgetApiProbe";

describe("widget API capability probe", () => {
  it("detects a routed method using an invalid chat without sending to a user", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "Bad Request: chat not found",
          }),
        ),
    );
    expect(await probeWidgetApi("TEST_TOKEN", fetch)).toMatchObject({
      available: true,
      errorCode: 400,
    });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).chat_id).toBe(0);
  });

  it("reports an unavailable Telegram API method", async () => {
    const result = await probeWidgetApi(
      "TEST_TOKEN",
      async () =>
        new Response(JSON.stringify({ ok: false, error_code: 404, description: "Not Found" })),
    );
    expect(result).toEqual({ available: false, errorCode: 404, description: "Not Found" });
  });

  it("redacts the token from diagnostic output", async () => {
    const result = await probeWidgetApi(
      "TEST_TOKEN",
      async () => new Response(JSON.stringify({ error_code: 400, description: "TEST_TOKEN" })),
    );
    expect(JSON.stringify(result)).not.toContain("TEST_TOKEN");
  });
});
