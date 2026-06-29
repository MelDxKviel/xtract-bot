import { describe, expect, it } from "vitest";

import type { AppContext } from "@/bot/context";
import { adminComposer } from "@/bot/handlers/admin";

import { createHarness } from "./support/botHarness";

interface FakeCacheCalls {
  clearAll: number;
  clearExpired: number;
}

interface InjectConfig {
  isAdmin?: boolean;
  clearAllCount?: number;
  clearExpiredCount?: number;
  avatarEmojiAvailable?: boolean;
}

function inject(config: InjectConfig, calls: FakeCacheCalls, actions: string[]) {
  return (ctx: AppContext) => {
    ctx.services = {
      access: { isAdmin: () => config.isAdmin ?? true },
      stats: {},
      tweetShare: {},
      avatarEmoji: config.avatarEmojiAvailable
        ? {
            fallbackGlyph: "👤",
            async resolve() {
              return null;
            },
          }
        : undefined,
    } as unknown as AppContext["services"];
    ctx.repositories = {
      tweetCache: {
        async clearAll() {
          calls.clearAll += 1;
          return config.clearAllCount ?? 0;
        },
        async clearExpired() {
          calls.clearExpired += 1;
          return config.clearExpiredCount ?? 0;
        },
      },
      profileCache: {
        async clearAll() {
          return 0;
        },
        async clearExpired() {
          return 0;
        },
      },
      adminActions: {
        async create(input: { action: string }) {
          actions.push(input.action);
        },
      },
    } as unknown as AppContext["repositories"];
    ctx.runtimeConfig = {
      whitelistEnabled: true,
      russianTranslationEnabled: false,
      avatarEmojiEnabled: false,
    };
  };
}

function adminText(text: string): Record<string, unknown> {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 0,
      chat: { id: 100, type: "private", first_name: "U" },
      from: { id: 100, is_bot: false, first_name: "U" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0]!.length }],
    },
  };
}

function harness(config: InjectConfig = {}) {
  const calls: FakeCacheCalls = { clearAll: 0, clearExpired: 0 };
  const actions: string[] = [];
  const h = createHarness({
    register: (bot) => bot.use(adminComposer),
    inject: inject(config, calls, actions),
  });
  return { h, calls, actions };
}

describe("admin /clearcache", () => {
  it("clears the whole cache and logs the action", async () => {
    const { h, calls, actions } = harness({ isAdmin: true, clearAllCount: 7 });
    await h.handle(adminText("/clearcache"));
    expect(calls.clearAll).toBe(1);
    expect(calls.clearExpired).toBe(0);
    expect(actions).toEqual(["clearcache"]);
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("Удалено записей: 7");
  });

  it("clears only expired entries with the `expired` argument", async () => {
    const { h, calls, actions } = harness({ isAdmin: true, clearExpiredCount: 3 });
    await h.handle(adminText("/clearcache expired"));
    expect(calls.clearExpired).toBe(1);
    expect(calls.clearAll).toBe(0);
    expect(actions).toEqual(["clearcache_expired"]);
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain(
      "просроченных записей кэша: 3",
    );
  });

  it("refuses non-admins and touches nothing", async () => {
    const { h, calls, actions } = harness({ isAdmin: false });
    await h.handle(adminText("/clearcache"));
    expect(calls.clearAll).toBe(0);
    expect(calls.clearExpired).toBe(0);
    expect(actions).toEqual([]);
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("только администратору");
  });
});

describe("admin /avataremoji", () => {
  it("turns the feature on", async () => {
    const { h } = harness({ isAdmin: true, avatarEmojiAvailable: true });
    await h.handle(adminText("/avataremoji on"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("включены");
  });

  it("turns the feature off", async () => {
    const { h } = harness({ isAdmin: true, avatarEmojiAvailable: true });
    await h.handle(adminText("/avataremoji off"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("выключены");
  });

  it("reports unavailable when no sticker-set owner is configured", async () => {
    const { h } = harness({ isAdmin: true, avatarEmojiAvailable: false });
    await h.handle(adminText("/avataremoji on"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("недоступны");
  });

  it("refuses non-admins", async () => {
    const { h } = harness({ isAdmin: false, avatarEmojiAvailable: true });
    await h.handle(adminText("/avataremoji on"));
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("только администратору");
  });
});
