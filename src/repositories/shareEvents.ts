import { sql as drizzleSql, eq } from "drizzle-orm";

import type { DatabaseTx } from "@/db/client";
import { shareEvents } from "@/db/schema";

export interface CreateShareEventInput {
  telegramUserId: number;
  chatId: number | null;
  tweetId: string | null;
  sourceUrl: string;
  mode: string;
  status: string;
  errorCode?: string | null;
}

export interface ShareEventSummary {
  total: number;
  success: number;
  errors: number;
  private: number;
  inline: number;
  users: number;
}

export interface ShareEventRepository {
  create(input: CreateShareEventInput): Promise<void>;
  summary(options?: { telegramUserId?: number | null }): Promise<ShareEventSummary>;
}

export function createShareEventRepository(tx: DatabaseTx): ShareEventRepository {
  return {
    async create(input): Promise<void> {
      await tx.insert(shareEvents).values({
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        tweetId: input.tweetId,
        sourceUrl: input.sourceUrl,
        mode: input.mode,
        status: input.status,
        errorCode: input.errorCode ?? null,
      });
    },

    async summary({ telegramUserId } = {}): Promise<ShareEventSummary> {
      const query = tx
        .select({
          total: drizzleSql<number>`count(*)::int`,
          success: drizzleSql<number>`count(*) filter (where ${shareEvents.status} = 'success')::int`,
          errors: drizzleSql<number>`count(*) filter (where ${shareEvents.status} = 'error')::int`,
          private: drizzleSql<number>`count(*) filter (where ${shareEvents.mode} = 'private')::int`,
          inline: drizzleSql<number>`count(*) filter (where ${shareEvents.mode} = 'inline')::int`,
          users: drizzleSql<number>`count(distinct ${shareEvents.telegramUserId})::int`,
        })
        .from(shareEvents);

      const rows =
        telegramUserId !== undefined && telegramUserId !== null
          ? await query.where(eq(shareEvents.telegramUserId, telegramUserId))
          : await query;
      const row = rows[0];
      return {
        total: row?.total ?? 0,
        success: row?.success ?? 0,
        errors: row?.errors ?? 0,
        private: row?.private ?? 0,
        inline: row?.inline ?? 0,
        users: row?.users ?? 0,
      };
    },
  };
}
