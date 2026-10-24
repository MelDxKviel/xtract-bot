import { eq, sql as drizzleSql } from "drizzle-orm";

import type { RuntimeConfig } from "@/bot/context";
import type { DatabaseTx } from "@/db/client";
import { botSettings } from "@/db/schema";

export const SETTING_WHITELIST_ENABLED = "whitelist_enabled";
export const SETTING_RUSSIAN_TRANSLATION_ENABLED = "russian_translation_enabled";

export function resolveRuntimeConfigFromStored(
  storedWhitelist: boolean | null,
  storedTranslation: boolean | null,
  defaults: RuntimeConfig,
): { runtimeConfig: RuntimeConfig; seedWhitelist: boolean; seedTranslation: boolean } {
  const runtimeConfig: RuntimeConfig = {
    whitelistEnabled: storedWhitelist ?? defaults.whitelistEnabled,
    russianTranslationEnabled: storedTranslation ?? defaults.russianTranslationEnabled,
  };
  return {
    runtimeConfig,
    seedWhitelist: storedWhitelist === null,
    seedTranslation: storedTranslation === null,
  };
}

export interface BotSettingsRepository {
  getBool(key: string): Promise<boolean | null>;
  setBool(key: string, value: boolean): Promise<void>;
  loadOrSeedRuntimeConfig(defaults: RuntimeConfig): Promise<RuntimeConfig>;
}

export function createBotSettingsRepository(tx: DatabaseTx): BotSettingsRepository {
  return {
    async getBool(key): Promise<boolean | null> {
      const rows = await tx
        .select({ valueBool: botSettings.valueBool })
        .from(botSettings)
        .where(eq(botSettings.key, key))
        .limit(1);
      return rows[0]?.valueBool ?? null;
    },

    async setBool(key, value): Promise<void> {
      await tx
        .insert(botSettings)
        .values({ key, valueBool: value })
        .onConflictDoUpdate({
          target: botSettings.key,
          set: { valueBool: value, updatedAt: drizzleSql`now()` },
        });
    },

    async loadOrSeedRuntimeConfig(defaults): Promise<RuntimeConfig> {
      const storedWhitelist = await this.getBool(SETTING_WHITELIST_ENABLED);
      const storedTranslation = await this.getBool(SETTING_RUSSIAN_TRANSLATION_ENABLED);
      const { runtimeConfig, seedWhitelist, seedTranslation } = resolveRuntimeConfigFromStored(
        storedWhitelist,
        storedTranslation,
        defaults,
      );

      if (seedWhitelist) {
        await this.setBool(SETTING_WHITELIST_ENABLED, runtimeConfig.whitelistEnabled);
      }
      if (seedTranslation) {
        await this.setBool(
          SETTING_RUSSIAN_TRANSLATION_ENABLED,
          runtimeConfig.russianTranslationEnabled,
        );
      }

      return runtimeConfig;
    },
  };
}
