"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/analytics", label: "Rendimiento" },
  { href: "/analytics/costs", label: "Costos" },
];

/**
 * Rendimiento y costo son dos preguntas distintas sobre los mismos videos ("¿funciono?" y "¿cuanto
 * costo?"), asi que viven en dos pantallas y no en una sola con quince graficas. Cliente unicamente
 * por `usePathname`, que es lo que marca cual esta abierta.
 */
export function AnalyticsTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
