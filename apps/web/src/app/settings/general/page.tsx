import { appSettings, db, DEFAULT_USD_TO_MXN_RATE, USD_TO_MXN_RATE_KEY } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ExchangeRateForm } from "@/components/exchange-rate-form";

export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, USD_TO_MXN_RATE_KEY) });
  const rate = row ? Number(row.value) : DEFAULT_USD_TO_MXN_RATE;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">General</h1>
        <p className="text-sm text-muted-foreground">
          Tipo de cambio usado para mostrar el costo de cada video en pesos mexicanos, ademas de dolares.
        </p>
      </div>
      <ExchangeRateForm initialRate={rate} />
    </div>
  );
}
