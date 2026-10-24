import { describe, expect, it } from "vitest";

import { resolveRuntimeConfigFromStored } from "@/repositories/botSettings";

describe("resolveRuntimeConfigFromStored", () => {
  const defaults = { whitelistEnabled: true, russianTranslationEnabled: false };

  it("uses env defaults and marks both keys for seeding when DB is empty", () => {
    const result = resolveRuntimeConfigFromStored(null, null, defaults);
    expect(result.runtimeConfig).toEqual(defaults);
    expect(result.seedWhitelist).toBe(true);
    expect(result.seedTranslation).toBe(true);
  });

  it("keeps stored values and does not re-seed when both keys exist", () => {
    const result = resolveRuntimeConfigFromStored(false, true, defaults);
    expect(result.runtimeConfig).toEqual({
      whitelistEnabled: false,
      russianTranslationEnabled: true,
    });
    expect(result.seedWhitelist).toBe(false);
    expect(result.seedTranslation).toBe(false);
  });

  it("seeds only the missing key", () => {
    const result = resolveRuntimeConfigFromStored(false, null, defaults);
    expect(result.runtimeConfig).toEqual({
      whitelistEnabled: false,
      russianTranslationEnabled: false,
    });
    expect(result.seedWhitelist).toBe(false);
    expect(result.seedTranslation).toBe(true);
  });
});
