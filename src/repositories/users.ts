import { desc, eq, sql as drizzleSql } from "drizzle-orm";

import type { DatabaseTx } from "@/db/client";
import { users, type UserRow } from "@/db/schema";

export interface UpsertUserInput {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface UserRepository {
  upsert(telegramId: number, input?: UpsertUserInput): Promise<UserRow>;
  getByTelegramId(telegramId: number): Promise<UserRow | null>;
  isAllowed(telegramId: number): Promise<boolean>;
  setAllowed(telegramId: number, allowed: boolean): Promise<UserRow>;
  listAllowed(options?: { limit?: number }): Promise<UserRow[]>;
  countAllowed(): Promise<number>;
}

export function createUserRepository(tx: DatabaseTx): UserRepository {
  return {
    async upsert(telegramId, input = {}): Promise<UserRow> {
      const existing = await this.getByTelegramId(telegramId);
      if (existing === null) {
        const [created] = await tx
          .insert(users)
          .values({
            telegramId,
            username: input.username ?? null,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            isAllowed: false,
          })
          .returning();
        if (!created) throw new Error("failed to insert user");
        return created;
      }
      const [updated] = await tx
        .update(users)
        .set({
          username: input.username ?? null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          updatedAt: drizzleSql`now()`,
        })
        .where(eq(users.telegramId, telegramId))
        .returning();
      if (!updated) throw new Error("failed to update user");
      return updated;
    },

    async getByTelegramId(telegramId): Promise<UserRow | null> {
      const rows = await tx.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      return rows[0] ?? null;
    },

    async isAllowed(telegramId): Promise<boolean> {
      const rows = await tx
        .select({ isAllowed: users.isAllowed })
        .from(users)
        .where(eq(users.telegramId, telegramId))
        .limit(1);
      return rows[0]?.isAllowed === true;
    },

    async setAllowed(telegramId, allowed): Promise<UserRow> {
      const existing = await this.getByTelegramId(telegramId);
      if (existing === null) {
        const [created] = await tx
          .insert(users)
          .values({ telegramId, isAllowed: allowed })
          .returning();
        if (!created) throw new Error("failed to insert user");
        return created;
      }
      const [updated] = await tx
        .update(users)
        .set({ isAllowed: allowed, updatedAt: drizzleSql`now()` })
        .where(eq(users.telegramId, telegramId))
        .returning();
      if (!updated) throw new Error("failed to update user");
      return updated;
    },

    async listAllowed({ limit = 100 } = {}): Promise<UserRow[]> {
      return tx
        .select()
        .from(users)
        .where(eq(users.isAllowed, true))
        .orderBy(desc(users.createdAt))
        .limit(limit);
    },

    async countAllowed(): Promise<number> {
      const rows = await tx
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.isAllowed, true));
      return rows[0]?.count ?? 0;
    },
  };
}
