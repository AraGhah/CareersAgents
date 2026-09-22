import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Internship Desk",
  description: "Suivi de stages hiver 2027 — Montréal / Laval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="top">
          <div className="brand-block">
            <span className="brand">Internship Desk</span>
            <span className="brand-sub">Hiver 2027 · Ara Ghahramanyan</span>
          </div>
          <nav>
            <Link href="/">Offres</Link>
            <Link href="/board">Pipeline</Link>
            <Link href="/followups">Relances</Link>
            <Link href="/answers">Banque</Link>
            <Link href="/jobs/new">Ajouter</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
