import { db, platformAccounts } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AccountsSettingsPage() {
  const accounts = await db.select().from(platformAccounts);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Cuentas conectadas</h1>

      <div className="flex gap-3">
        <a href="/api/oauth/youtube/start">
          <Button variant="outline">Conectar YouTube</Button>
        </a>
        <a href="/api/oauth/facebook/start">
          <Button variant="outline">Conectar Facebook</Button>
        </a>
      </div>

      <div className="space-y-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base capitalize">{account.platform}</CardTitle>
                <Badge variant={account.isActive ? "default" : "outline"}>
                  {account.isActive ? "activa" : "inactiva"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {account.accountLabel ?? account.externalAccountId ?? account.id}
            </CardContent>
          </Card>
        ))}
        {accounts.length === 0 && <p className="text-sm text-muted-foreground">No hay cuentas conectadas aun.</p>}
      </div>
    </div>
  );
}
