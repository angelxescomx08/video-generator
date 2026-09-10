import { db, learningExperiments, playbookRules } from "@/lib/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const [rules, experiments] = await Promise.all([
    db.select().from(playbookRules).orderBy(desc(playbookRules.createdAt)),
    db.select().from(learningExperiments).orderBy(desc(learningExperiments.createdAt)),
  ]);
  return <div className="space-y-8">
    <div className="space-y-1"><h1 className="text-2xl font-bold">Playbook de aprendizaje</h1><p className="text-sm text-muted-foreground">Las skills de narracion son estables. Estas reglas son resultados medidos, tienen alcance, evidencia y fecha de retiro.</p></div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Reglas activas y en validacion</h2>{rules.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Aun no hay reglas promovidas. Crea y valida un experimento antes de enviar una instruccion al generador.</p> : <div className="space-y-3">{rules.map((rule) => <article key={rule.id} className="rounded-lg border bg-card p-4 space-y-2"><div className="flex justify-between gap-3"><h3 className="font-medium">{rule.instruction}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rule.status}</span></div><p className="text-sm text-muted-foreground">{scopeLabel(rule.scope)}</p><p className="text-sm">Evidencia: {signed(rule.evidence.effectPoints)} pp en {rule.evidence.metric} · {rule.evidence.sampleSize} videos · guardrails {rule.evidence.guardrailsPassed ? "superados" : "fallidos"}.</p><p className="text-xs text-muted-foreground">{rule.expiresAt ? `Revalidar antes de ${rule.expiresAt.toLocaleDateString("es-MX")}.` : "Sin caducidad definida."}</p></article>)}</div>}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Hipotesis y experimentos</h2>{experiments.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No hay experimentos registrados todavia.</p> : <div className="space-y-3">{experiments.map((exp) => <article key={exp.id} className="rounded-lg border bg-card p-4 space-y-2"><div className="flex justify-between gap-3"><h3 className="font-medium">{exp.name}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{exp.status}</span></div><p className="text-sm text-muted-foreground">{exp.hypothesis}</p><p className="text-sm">Metrica primaria: {exp.primaryMetric} · efecto minimo: {exp.minEffectPoints} pp</p><p className="text-xs text-muted-foreground">Control: {exp.controlLabel} · Tratamiento: {exp.treatmentLabel}</p></article>)}</div>}</section>
  </div>;
}
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value}`; }
function scopeLabel(scope: { formats?: string[]; themeIds?: string[]; minDuration?: number; maxDuration?: number }) { const bits = [scope.formats?.join(" / "), scope.themeIds?.length ? `${scope.themeIds.length} tema(s)` : undefined, scope.minDuration || scope.maxDuration ? `${scope.minDuration ?? 0}-${scope.maxDuration ?? "sin limite"} s` : undefined].filter(Boolean); return bits.length ? `Aplica a: ${bits.join(" · ")}` : "Aplica a todo el canal"; }
