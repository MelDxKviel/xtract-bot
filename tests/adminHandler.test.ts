import { describe, expect, it } from "vitest";

import type { AppContext, RuntimeConfig } from "@/bot/context";
import { adminComposer } from "@/bot/handlers/admin";
import {
  SETTING_RUSSIAN_TRANSLATION_ENABLED,
  SETTING_WHITELIST_ENABLED,
} from "@/repositories/botSettings";

import { createHarness } from "./support/botHarness";

interface FakeCacheCalls {
  clearAll: number;
  clearExpired: number;
}

interface InjectConfig {
  isAdmin?: boolean;
  clearAllCount?: number;
  clearExpiredCount?: number;
  whitelistEnabled?: boolean;
  russianTranslationEnabled?: boolean;
  forPanel?: boolean;
  /** When true, botSettings.setBool rejects (simulates DB failure). */
  setBoolFails?: boolean;
}

function inject(
  config: InjectConfig,
  calls: FakeCacheCalls,
  actions: string[],
  settingsWrites: Array<{ key: string; value: boolean }>,
  runtimeConfig: RuntimeConfig,
) {
  return (ctx: AppContext) => {
    ctx.services = {
      access: {
        isAdmin: () => config.isAdmin ?? true,
        countAllowedUsers: async () => 0,
      },
      stats: {
        getSummary: async () => ({
          total: 0,
          success: 0,
          errors: 0,
          private: 0,
          inline: 0,
          users: 0,
        }),
      },
      tweetShare: {},
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
        async count() {
          return 0;
        },
      },
      profileCache: {
        async clearAll() {
          return 0;
        },
        async clearExpired() {
          return 0;
        },
        async count() {
          return 0;
        },
      },
      adminActions: {
        async create(input: { action: string }) {
          actions.push(input.action);
        },
      },
      botSettings: {
        async setBool(key: string, value: boolean) {
          if (config.setBoolFails) {
            throw new Error("simulated bot_settings write failure");
          }
          settingsWrites.push({ key, value });
        },
      },
    } as unknown as AppContext["repositories"];
    ctx.settings = {
      cacheCleanupEnabled: false,
      cacheCleanupIntervalSeconds: 3600,
    } as unknown as AppContext["settings"];
    ctx.runtimeConfig = runtimeConfig;
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

function adminCallback(data: string): Record<string, unknown> {
  return {
    update_id: 2,
    callback_query: {
      id: "cb1",
      from: { id: 100, is_bot: false, first_name: "U" },
      chat_instance: "1",
      data,
      message: {
        message_id: 11,
        date: 0,
        chat: { id: 100, type: "private", first_name: "U" },
        text: "panel",
      },
    },
  };
}

function harness(config: InjectConfig = {}) {
  const calls: FakeCacheCalls = { clearAll: 0, clearExpired: 0 };
  const actions: string[] = [];
  const settingsWrites: Array<{ key: string; value: boolean }> = [];
  const runtimeConfig: RuntimeConfig = {
    whitelistEnabled: config.whitelistEnabled ?? true,
    russianTranslationEnabled: config.russianTranslationEnabled ?? false,
  };
  const h = createHarness({
    register: (bot) => bot.use(adminComposer),
    inject: inject(config, calls, actions, settingsWrites, runtimeConfig),
  });
  return { h, calls, actions, settingsWrites, runtimeConfig };
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
    const { h, calls, actions, settingsWrites } = harness({ isAdmin: false });
    await h.handle(adminText("/clearcache"));
    expect(calls.clearAll).toBe(0);
    expect(calls.clearExpired).toBe(0);
    expect(actions).toEqual([]);
    expect(settingsWrites).toEqual([]);
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("только администратору");
  });
});

describe("admin runtime toggles persist", () => {
  it("persists whitelist on/off then publishes runtimeConfig", async () => {
    const on = harness({ isAdmin: true, whitelistEnabled: false });
    await on.h.handle(adminText("/whitelist on"));
    expect(on.settingsWrites).toEqual([{ key: SETTING_WHITELIST_ENABLED, value: true }]);
    expect(on.runtimeConfig.whitelistEnabled).toBe(true);
    expect(String(on.h.lastCall("sendMessage")!.payload.text)).toContain("Whitelist включён");

    const off = harness({ isAdmin: true, whitelistEnabled: true });
    await off.h.handle(adminText("/whitelist off"));
    expect(off.settingsWrites).toEqual([{ key: SETTING_WHITELIST_ENABLED, value: false }]);
    expect(off.runtimeConfig.whitelistEnabled).toBe(false);
  });

  it("persists translate on/off then publishes runtimeConfig", async () => {
    const on = harness({ isAdmin: true, russianTranslationEnabled: false });
    await on.h.handle(adminText("/translate on"));
    expect(on.settingsWrites).toEqual([{ key: SETTING_RUSSIAN_TRANSLATION_ENABLED, value: true }]);
    expect(on.runtimeConfig.russianTranslationEnabled).toBe(true);

    const off = harness({ isAdmin: true, russianTranslationEnabled: true });
    await off.h.handle(adminText("/translate off"));
    expect(off.settingsWrites).toEqual([
      { key: SETTING_RUSSIAN_TRANSLATION_ENABLED, value: false },
    ]);
    expect(off.runtimeConfig.russianTranslationEnabled).toBe(false);
  });

  it("persists panel translate toggle then publishes runtimeConfig", async () => {
    const { h, settingsWrites, runtimeConfig } = harness({
      isAdmin: true,
      russianTranslationEnabled: false,
      forPanel: true,
    });
    await h.handle(adminCallback("panel:translate:toggle"));
    expect(settingsWrites).toEqual([{ key: SETTING_RUSSIAN_TRANSLATION_ENABLED, value: true }]);
    expect(runtimeConfig.russianTranslationEnabled).toBe(true);
    expect(String(h.lastCall("answerCallbackQuery")!.payload.text)).toContain("включён");
  });

  it("does not write settings for status-only whitelist/translate queries", async () => {
    const whitelist = harness({ isAdmin: true });
    await whitelist.h.handle(adminText("/whitelist"));
    expect(whitelist.settingsWrites).toEqual([]);

    const translate = harness({ isAdmin: true });
    await translate.h.handle(adminText("/translate"));
    expect(translate.settingsWrites).toEqual([]);
  });

  it("does not mutate runtimeConfig when bot_settings write fails", async () => {
    const { h, settingsWrites, runtimeConfig } = harness({
      isAdmin: true,
      whitelistEnabled: false,
      setBoolFails: true,
    });
    await h.handle(adminText("/whitelist on"));
    expect(settingsWrites).toEqual([]);
    expect(runtimeConfig.whitelistEnabled).toBe(false);
    expect(String(h.lastCall("sendMessage")!.payload.text)).toContain("Не удалось сохранить");
  });

  it("does not mutate runtimeConfig when panel persist fails", async () => {
    const { h, settingsWrites, runtimeConfig } = harness({
      isAdmin: true,
      russianTranslationEnabled: false,
      setBoolFails: true,
    });
    await h.handle(adminCallback("panel:translate:toggle"));
    expect(settingsWrites).toEqual([]);
    expect(runtimeConfig.russianTranslationEnabled).toBe(false);
    expect(String(h.lastCall("answerCallbackQuery")!.payload.text)).toContain(
      "Не удалось сохранить",
    );
  });
});
