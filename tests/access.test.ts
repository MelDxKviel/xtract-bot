import { describe, expect, it } from "vitest";

import { createAccessService } from "@/services/access";

interface FakeUserRow {
  telegramId: number;
}

class FakeUsers {
  readonly allowed = new Set<number>();
  readonly saved: number[] = [];

  async upsert(telegramId: number): Promise<FakeUserRow> {
    this.saved.push(telegramId);
    return { telegramId };
  }

  async isAllowed(telegramId: number): Promise<boolean> {
    return this.allowed.has(telegramId);
  }

  async setAllowed(telegramId: number, allowed: boolean): Promise<FakeUserRow> {
    if (allowed) this.allowed.add(telegramId);
    else this.allowed.delete(telegramId);
    return { telegramId };
  }

  async listAllowed(): Promise<FakeUserRow[]> {
    return Array.from(this.allowed).map((id) => ({ telegramId: id }));
  }
}

describe("AccessService", () => {
  it("treats admins as always having access", async () => {
    const service = createAccessService(new FakeUsers() as never, new Set([1]));
    expect(await service.hasAccess(1)).toBe(true);
  });

  it("allows and denies users", async () => {
    const users = new FakeUsers();
    const service = createAccessService(users as never, new Set());
    expect(await service.hasAccess(2)).toBe(false);
    await service.allowUser(2);
    expect(await service.hasAccess(2)).toBe(true);
    await service.denyUser(2);
    expect(await service.hasAccess(2)).toBe(false);
  });

  it("opens access when whitelist is disabled", async () => {
    const service = createAccessService(new FakeUsers() as never, new Set(), {
      whitelistEnabled: false,
    });
    expect(await service.hasAccess(2)).toBe(true);
  });

  it("denies regular users when whitelist is enabled", async () => {
    const service = createAccessService(new FakeUsers() as never, new Set(), {
      whitelistEnabled: true,
    });
    expect(await service.hasAccess(2)).toBe(false);
  });

  it("delegates register to the repository", async () => {
    const users = new FakeUsers();
    const service = createAccessService(users as never, new Set());
    await service.registerUser({ id: 42, username: "u", first_name: "F", last_name: "L" });
    expect(users.saved).toEqual([42]);
  });
});
