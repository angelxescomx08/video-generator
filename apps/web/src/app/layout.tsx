import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Generator",
  description: "Generador de videos y shorts con IA",
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/videos/new", label: "Nuevo video" },
  { href: "/themes", label: "Temas" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings/providers", label: "Proveedores" },
  { href: "/settings/accounts", label: "Cuentas" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-border p-4">
            <div className="mb-6 text-lg font-bold">Video Generator</div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm hover:bg-secondary"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
