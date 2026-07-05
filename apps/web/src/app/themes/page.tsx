import Link from "next/link";
import { db, themes } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ThemesPage() {
  const rows = await db.select().from(themes);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Temas</h1>
        <Link href="/themes/new">
          <Button>Nuevo tema</Button>
        </Link>
      </div>

      <div className="space-y-3">
        {rows.map((theme) => (
          <Link key={theme.id} href={`/themes/${theme.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{theme.name}</CardTitle>
                  <Badge variant={theme.isActive ? "default" : "outline"}>
                    {theme.isActive ? "activo" : "inactivo"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {theme.description ?? theme.slug}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
