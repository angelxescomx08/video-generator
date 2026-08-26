"use client";

import { useId, useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tooltip de ayuda para un campo. Es CSS + estado local en vez de Radix a proposito: el proyecto no
 * tiene ninguna dependencia de primitivas de UI y no vale traer una para un solo componente.
 *
 * Se abre con hover Y con foco/click: los textos de estos tooltips son instrucciones de varias lineas
 * ("Studio > el video > Estadisticas > ..."), y un tooltip que solo responde a hover es imposible de
 * leer en movil e inaccesible con teclado.
 */
export function InfoTooltip({ title, body, where }: { title: string; body: string; where?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`Que es ${title}`}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={cn(
            "absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-md border border-border",
            "bg-popover p-3 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-lg",
          )}
        >
          <span className="block font-medium text-foreground">{title}</span>
          <span className="mt-1 block text-muted-foreground">{body}</span>
          {where && (
            <span className="mt-2 block border-t border-border pt-2 text-muted-foreground">
              <span className="font-medium text-foreground">Donde lo encuentras: </span>
              {where}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
