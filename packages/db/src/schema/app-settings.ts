import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Config global simple (key/value), ej. la tasa de cambio USD->MXN editable desde /settings/general. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export const USD_TO_MXN_RATE_KEY = "usd_to_mxn_rate";
export const DEFAULT_USD_TO_MXN_RATE = 18.5;
