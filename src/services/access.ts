import type { UserRepository } from "@/repositories/users";
import type { UserRow } from "@/db/schema";

export interface TelegramUserInfo {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

type AccessUserRepository = Pick<
  UserRepository,
  "upsert" | "isAllowed" | "setAllowed" | "listAllowed" | "countAllowed"
>;

export interface AccessService {
  isAdmin(telegramId: number): boolean;
  registerUser(user: TelegramUserInfo): Promise<void>;
  hasAccess(telegramId: number): Promise<boolean>;
  allowUser(telegramId: number): Promise<void>;
  denyUser(telegramId: number): Promise<void>;
  listAllowedUsers(options?: { limit?: number }): Promise<UserRow[]>;
  countAllowedUsers(): Promise<number>;
}

export function createAccessService(
  userRepository: AccessUserRepository,
  adminIds: ReadonlySet<number>,
  options: { whitelistEnabled?: boolean } = {},
): AccessService {
  const whitelistEnabled = options.whitelistEnabled ?? true;
  return {
    isAdmin(telegramId): boolean {
      return adminIds.has(telegramId);
    },
    async registerUser(user): Promise<void> {
      await userRepository.upsert(user.id, {
        username: user.username ?? null,
        firstName: user.first_name ?? null,
        lastName: user.last_name ?? null,
      });
    },
    async hasAccess(telegramId): Promise<boolean> {
      if (this.isAdmin(telegramId)) return true;
      if (!whitelistEnabled) return true;
      return userRepository.isAllowed(telegramId);
    },
    async allowUser(telegramId): Promise<void> {
      await userRepository.setAllowed(telegramId, true);
    },
    async denyUser(telegramId): Promise<void> {
      await userRepository.setAllowed(telegramId, false);
    },
    async listAllowedUsers(opts): Promise<UserRow[]> {
      return userRepository.listAllowed({ limit: opts?.limit ?? 100 }) as Promise<UserRow[]>;
    },
    async countAllowedUsers(): Promise<number> {
      return userRepository.countAllowed();
    },
  };
}
