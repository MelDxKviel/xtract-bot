import type { DatabaseTx } from "@/db/client";
import { adminActions } from "@/db/schema";

export interface CreateAdminActionInput {
  adminTelegramId: number;
  action: string;
  targetTelegramId?: number | null;
}

export interface AdminActionsRepository {
  create(input: CreateAdminActionInput): Promise<void>;
}

export function createAdminActionsRepository(tx: DatabaseTx): AdminActionsRepository {
  return {
    async create(input): Promise<void> {
      await tx.insert(adminActions).values({
        adminTelegramId: input.adminTelegramId,
        action: input.action,
        targetTelegramId: input.targetTelegramId ?? null,
      });
    },
  };
}
