import { db, providerConfigs } from "@/lib/db";
import { ProviderSettingsPanel } from "@/components/provider-settings-panel";

export const dynamic = "force-dynamic";

export default async function ProvidersSettingsPage() {
  const rows = await db.select().from(providerConfigs);

  const currentDefaults = Object.fromEntries(
    rows.filter((r) => r.isDefault).map((r) => [r.providerType, r.providerName]),
  );
  // Los tipos multi-seleccion (stock) necesitan saber cada fila habilitada, no solo el default.
  const enabled = rows.filter((r) => r.isEnabled).map((r) => `${r.providerType}:${r.providerName}`);
  // Modelo guardado por proveedor (config.model), keyado igual que `enabled` porque cada proveedor
  // de un mismo tipo puede tener su propio modelo elegido.
  const currentModels = Object.fromEntries(
    rows
      .filter((r) => (r.config as { model?: string } | null)?.model)
      .map((r) => [`${r.providerType}:${r.providerName}`, (r.config as { model: string }).model]),
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proveedores</h1>
        <p className="text-sm text-muted-foreground">
          Elige que proveedor usar para cada paso. Los gratuitos no requieren tarjeta, ideales para probar; los
          de pago requieren su API key en .env.
        </p>
      </div>
      <ProviderSettingsPanel currentDefaults={currentDefaults} initialEnabled={enabled} currentModels={currentModels} />
    </div>
  );
}
