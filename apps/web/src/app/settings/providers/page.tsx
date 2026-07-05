import { db, providerConfigs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { ProviderSettingsPanel } from "@/components/provider-settings-panel";

export const dynamic = "force-dynamic";

export default async function ProvidersSettingsPage() {
  const rows = await db.select().from(providerConfigs).where(eq(providerConfigs.isDefault, true));
  const currentDefaults = Object.fromEntries(rows.map((r) => [r.providerType, r.providerName]));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proveedores</h1>
        <p className="text-sm text-muted-foreground">
          Elige que proveedor usar para cada paso. Los gratuitos no requieren tarjeta, ideales para probar; los
          de pago requieren su API key en .env.
        </p>
      </div>
      <ProviderSettingsPanel currentDefaults={currentDefaults} />
    </div>
  );
}
