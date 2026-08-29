import type { ReactNode } from "react";

/**
 * La caja comun de todas las graficas: titulo, leyenda, area de dibujo y tabla de respaldo.
 *
 * DECISIONES QUE APLICAN A TODO EL KIT
 *
 * - **SVG renderizado en el servidor, sin libreria de graficas.** No hay `recharts` ni `d3`: son
 *   200-500 KB de JavaScript en el navegador para dibujar unas decenas de rectangulos que el
 *   servidor ya sabe calcular. Las paginas de analiticas son componentes de servidor, asi que el
 *   HTML llega con la grafica ya dibujada y el cliente no descarga ni ejecuta nada.
 * - **Toda grafica trae su tabla.** No es solo accesibilidad: los tonos claros de la paleta quedan
 *   por debajo de 3:1 contra el fondo blanco, y la regla de la guia de dataviz para ese caso es que
 *   los valores tienen que ser legibles fuera del color. La tabla es ademas la unica forma de leer
 *   un valor exacto sin pasar el raton por encima.
 * - **El hover es `<title>` nativo del SVG.** Un tooltip propio exigiria JavaScript de cliente y
 *   convertiria estas paginas en componentes de cliente. El `<title>` da el valor al pasar el raton
 *   sin costo alguno, y la tabla garantiza que ningun dato dependa de ese hover.
 */

/**
 * El manual de una grafica concreta.
 *
 * Tiene esta forma fija y no un parrafo libre porque un parrafo tiende a explicar QUE es el dato y
 * dejar fuera lo unico que hace falta: como mirarlo y que hacer con lo que se vea. Las cuatro
 * preguntas son las que convierten una grafica bonita en una decision.
 */
export interface HowToRead {
  /** Que mide exactamente, incluida la definicion de la metrica si no es obvia. */
  measures: string;
  /** Como mirarla: que forma significa que va bien y cual que va mal. */
  read: string;
  /** Que hacer con lo que se ve. Opcional: hay graficas que solo describen. */
  act?: string;
  /** De donde salen los datos y que los limita — asi un hueco no se lee como un fallo. */
  source?: string;
}

interface ChartFrameProps {
  title: string;
  description?: string;
  /** Series para la leyenda. Con una sola serie no se dibuja: el titulo ya dice que es. */
  series?: { label: string; color: string }[];
  /** Filas de la tabla de respaldo, en el mismo orden que la grafica. */
  table?: { columns: string[]; rows: (string | number)[][] };
  /** Explicacion desplegable de que significa y como se lee. */
  howToRead?: HowToRead;
  /** Que decir cuando no hay datos — y, sobre todo, que hacer para que los haya. */
  empty?: string;
  isEmpty?: boolean;
  children: ReactNode;
}

export function ChartFrame({ title, description, series, table, howToRead, empty, isEmpty, children }: ChartFrameProps) {
  return (
    <figure className="m-0 space-y-3 rounded-md border border-border p-4">
      <figcaption className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </figcaption>

      {isEmpty ? (
        <p className="rounded-md bg-muted/40 p-4 text-xs text-muted-foreground">{empty ?? "Todavia no hay datos."}</p>
      ) : (
        <>
          {series && series.length > 1 && <ChartLegend series={series} />}
          <div className="overflow-x-auto">{children}</div>
        </>
      )}

      {/* La explicacion se muestra tambien con la grafica vacia: es justo cuando mas falta hace
          entender que se supone que deberia aparecer ahi. */}
      {(howToRead || (table && !isEmpty)) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {howToRead && <HowToReadDetails {...howToRead} />}
          {table && !isEmpty && <ChartTable {...table} />}
        </div>
      )}
    </figure>
  );
}

function HowToReadDetails({ measures, read, act, source }: HowToRead) {
  return (
    <details className="min-w-0 flex-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Como se lee</summary>
      <dl className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed">
        <Line term="Que mide" description={measures} />
        <Line term="Como leerla" description={read} />
        {act && <Line term="Que hacer" description={act} />}
        {source && <Line term="De donde sale" description={source} />}
      </dl>
    </details>
  );
}

function Line({ term, description }: { term: string; description: string }) {
  return (
    <div>
      <dt className="inline font-medium text-foreground">{term}: </dt>
      <dd className="inline text-muted-foreground">{description}</dd>
    </div>
  );
}

/** La identidad nunca depende solo del color: el texto va en tinta y el color lo lleva el punto. */
export function ChartLegend({ series }: { series: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="min-w-0 flex-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Ver los datos</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full">
          <thead className="sticky top-0 bg-secondary text-left">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-2 py-1.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {row.map((cell, j) => (
                  <td key={j} className={j === 0 ? "px-2 py-1.5" : "px-2 py-1.5 tabular-nums"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
