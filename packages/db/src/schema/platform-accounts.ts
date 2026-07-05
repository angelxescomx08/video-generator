import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PLATFORMS = ["youtube", "facebook", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const platformAccounts = pgTable("platform_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull().$type<Platform>(),
  accountLabel: text("account_label"),
  externalAccountId: text("external_account_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scopes: text("scopes").array(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type NewPlatformAccount = typeof platformAccounts.$inferInsert;
