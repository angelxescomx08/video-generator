import { db } from "@/lib/db";
import { themes, topicProposals } from "@video-generator/db";
import { desc, eq } from "drizzle-orm";
import { TopicDiscoveryForm } from "@/components/topic-discovery-form";
import { TopicProposalCard } from "@/components/topic-proposal-card";

export const dynamic = "force-dynamic";

/**
 * Ideas de video que propuso el sistema despues de buscar en la web.
 *
 * Es la contraparte hacia AFUERA de /analytics/discoveries: aquella pantalla enseña que se pregunta
 * el sistema sobre lo que ya hizo, esta enseña de que podria hablar despues. Las dos comparten la
 * misma regla — la IA propone, el dato dispone — solo que aqui el dato es la distancia coseno
 * contra los guiones ya publicados, no la retencion.
 *
 * Las descartadas por repetidas se muestran, no se esconden: sin verlas no hay forma de saber si el
 * detector esta afinado o esta tirando ideas buenas, y el umbral no se puede ajustar a ciegas.
 */
export default async function TopicsPage() {
  const [themeRows, proposals] = await Promise.all([
    db.select({ id: themes.id, name: themes.name }).from(themes).where(eq(themes.isActive, true)),
    db.select().from(topicProposals).orderBy(desc(topicProposals.createdAt)).limit(60),
  ]);

  const pending = proposals.filter((p) => p.status === "pending");
  const duplicates = proposals.filter((p) => p.status === "duplicate");
  const decided = proposals.filter((p) => p.status === "approved" || p.status === "rejected");

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Ideas que propuso el sistema</h1>
        <p className="text-sm text-muted-foreground">
          Busca en la web abierta, propone temas apoyados en lo que encuentra y compara cada idea
          contra los guiones que este canal ya publico. Lo que decide si una idea es repetida no es
          el modelo diciendo que no lo recuerda, sino la distancia semantica contra tus guiones
          reales.
        </p>
      </div>

      <TopicDiscoveryForm themes={themeRows} />

      <Section
        title="Para revisar"
        count={pending.length}
        empty="Nada pendiente. Lanza una busqueda arriba para traer ideas nuevas."
      >
        {pending.map((p) => (
          <TopicProposalCard key={p.id} proposal={serialize(p)} />
        ))}
      </Section>

      {duplicates.length > 0 && (
        <Section
          title="Descartadas por parecerse a algo que ya hiciste"
          count={duplicates.length}
          empty=""
          hint="Se muestran a proposito: si aqui aparece algo que en realidad era distinto, el umbral de similitud esta demasiado bajo."
        >
          {duplicates.map((p) => (
            <TopicProposalCard key={p.id} proposal={serialize(p)} />
          ))}
        </Section>
      )}

      {decided.length > 0 && (
        <Section title="Ya resueltas" count={decided.length} empty="">
          {decided.map((p) => (
            <TopicProposalCard key={p.id} proposal={serialize(p)} />
          ))}
        </Section>
      )}
    </div>
  );
}

function serialize(row: typeof topicProposals.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    angle: row.angle,
    status: row.status,
    sources: row.sources ?? [],
    similarityScore: row.similarityScore ? Number(row.similarityScore) : null,
    similarToVideoId: row.similarToVideoId,
    createdVideoId: row.createdVideoId,
    searchQuery: row.searchQuery,
  };
}

function Section({
  title,
  count,
  empty,
  hint,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          {title} <span className="text-sm font-normal text-muted-foreground">({count})</span>
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}
