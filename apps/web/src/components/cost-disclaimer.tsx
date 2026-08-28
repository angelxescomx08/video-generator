/**
 * El desglose es un ESTIMADO, no una lectura de facturacion: ninguna de estas APIs devuelve un
 * costo. Decirlo explicitamente evita que estos numeros se tomen como la factura real, sobre todo
 * porque las capas gratuitas suelen dejar el cobro efectivo en cero.
 *
 * Vive aparte porque lo muestran dos pantallas — el panel de un video y el tablero de costos — y una
 * advertencia que solo aparece en una de las dos no advierte de nada.
 */
export function CostDisclaimer() {
  return (
    <details className="rounded-md border border-border bg-muted/50 p-3">
      <summary className="cursor-pointer text-xs font-medium">
        Como se calculan estos costos (estimados, no facturacion real)
      </summary>
      <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Es un estimado.</span> Ninguna API devuelve un
          costo. Se multiplica el uso real (tokens que reporta el modelo, caracteres enviados al TTS) por
          una tabla de precios que vive en el repositorio.
        </li>
        <li>
          <span className="font-medium text-foreground">No descuenta capas gratuitas.</span> Si estas en
          el free tier de Gemini o dentro del millon de caracteres mensuales gratis de Google TTS, lo que
          te facturan es <span className="font-medium text-foreground">$0</span> aunque aqui aparezca un
          monto. Lo que se muestra es el costo marginal una vez agotada esa cuota.
        </li>
        <li>
          <span className="font-medium text-foreground">Los precios se actualizan a mano.</span> Ultima
          revision: 23 de agosto de 2026. Varias tarifas de Gemini son promocionales y se duplican el 1 de
          enero de 2027; los alias tipo <code className="text-[11px]">gemini-flash-latest</code> pueden
          cambiar de modelo (y de precio) sin aviso.
        </li>
        <li>
          <span className="font-medium text-foreground">El tipo de cambio es fijo</span>, no una tasa en
          vivo. Se puede ajustar en Configuracion general.
        </li>
        <li>
          Cada version guarda una foto del costo del momento: actualizar la tabla de precios no recalcula
          versiones anteriores.
        </li>
        <li>
          <span className="font-medium text-foreground">El modelo puede faltar en videos viejos.</span> Se
          empezo a guardar como un campo propio despues de los primeros renders; en los anteriores se
          rescata del texto del detalle, y cuando ni eso hay, el costo aparece agrupado bajo el nombre del
          proveedor.
        </li>
      </ul>
    </details>
  );
}
