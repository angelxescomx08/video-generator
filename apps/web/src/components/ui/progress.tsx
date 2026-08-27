import { cn } from "@/lib/utils";

/**
 * Barra de progreso. Con `value` (0-100) muestra el avance real; con `indeterminate` muestra una
 * banda que se desliza, para las esperas donde no hay porcentaje que reportar (p.ej. el servidor ya
 * recibio el archivo y lo esta guardando).
 */
export function Progress({
  value,
  indeterminate = false,
  className,
}: {
  value?: number;
  indeterminate?: boolean;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, value ?? 0));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
    >
      {indeterminate ? (
        <div className="h-full w-1/3 animate-progress-slide rounded-full bg-primary" />
      ) : (
        <div
          className="relative h-full overflow-hidden rounded-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        >
          <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-primary-foreground/40 to-transparent" />
        </div>
      )}
    </div>
  );
}
