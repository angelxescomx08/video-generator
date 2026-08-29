import Link from "next/link";
import {
  bucketCount,
  GRANULARITIES,
  GRANULARITY_LABELS,
  RANGE_LABELS,
  suggestedGranularity,
  TIME_RANGES,
  type Granularity,
  type TimeRange,
  type TimeRangeKey,
} from "@video-generator/analytics";

/**
 * La fila de filtros que manda sobre TODAS las graficas de la pantalla.
 *
 * Una sola fila arriba, nunca un selector dentro de cada tarjeta: si cada grafica tuviera su propio
 * rango, dos graficas contiguas estarian mirando periodos distintos y compararlas — que es lo que
 * uno hace sin darse cuenta — daria conclusiones falsas.
 *
 * Son enlaces, no botones: el estado vive en la URL (`?r=90d&g=week`), asi que la pantalla sigue
 * siendo un componente de servidor, cambiar de periodo no descarga ni ejecuta JavaScript, el filtro
 * sobrevive a un refresco y "los ultimos 12 meses por mes" se puede compartir como enlace.
 */
export function TimeControls({
  basePath,
  current,
  extraParams,
}: {
  basePath: string;
  current: TimeRange;
  /** Otros parametros de la URL que hay que conservar al cambiar de periodo. */
  extraParams?: Record<string, string>;
}) {
  const href = (next: Partial<{ r: TimeRangeKey; g: Granularity }>) => {
    const params = new URLSearchParams({ ...extraParams, r: current.range, g: current.granularity, ...next });
    return `${basePath}?${params.toString()}`;
  };

  const buckets = bucketCount(current);
  const tooMany = buckets !== null && buckets > 120;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Group label="Periodo">
          {TIME_RANGES.map((range) => (
            <Option key={range} href={href({ r: range })} isActive={range === current.range}>
              {RANGE_LABELS[range]}
            </Option>
          ))}
        </Group>
        <Group label="Agrupado por">
          {GRANULARITIES.map((granularity) => (
            <Option key={granularity} href={href({ g: granularity })} isActive={granularity === current.granularity}>
              {GRANULARITY_LABELS[granularity]}
            </Option>
          ))}
        </Group>
      </div>

      {/* Se avisa, no se corrige solo: forzar la agrupacion seria decidir por el usuario algo que
          quiza pidio a proposito para exportar la tabla. */}
      {tooMany && (
        <p className="text-[11px] text-muted-foreground">
          Son ~{buckets} columnas en pantalla, demasiadas para leerlas. Prueba{" "}
          <Link href={href({ g: suggestedGranularity(current.range) })} className="underline">
            agrupar por {GRANULARITY_LABELS[suggestedGranularity(current.range)].toLowerCase()}
          </Link>
          .
        </p>
      )}
      {current.range === "all" && (
        <p className="text-[11px] text-muted-foreground">
          &quot;Todo&quot; recorre el historial completo de estadisticas. Con el canal ya crecido, agrupar por
          mes o por ano mantiene la consulta ligera y la grafica legible.
        </p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Option({ href, isActive, children }: { href: string; isActive: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "true" : undefined}
      className={`rounded-md px-2 py-1 text-xs transition-colors ${
        isActive ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}
