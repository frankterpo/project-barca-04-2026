import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lobster IC",
  description: "Auditable AI investment committee demo",
};

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-bg-muted hover:text-text-primary"
    >
      {children}
    </Link>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg-app text-text-primary">
        <div className="min-h-full">
          <header className="border-b border-border-subtle bg-bg-elevated/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-accent/20 ring-1 ring-accent/40" />
                <div>
                  <div className="text-sm font-semibold tracking-tight">Lobster IC</div>
                  <div className="text-xs text-text-muted">Committee demo (mock data)</div>
                </div>
              </div>
              <nav className="flex flex-wrap items-center gap-1" aria-label="Primary">
                <NavLink href="/portfolio">Portfolio</NavLink>
                <NavLink href="/judge-mode">Judge Mode</NavLink>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
