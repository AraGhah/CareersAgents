import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Nav, type NavItem } from "./components/nav";
import { ThemeToggle } from "./components/client-ui";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: { default: "Internship Desk", template: "%s · Internship Desk" },
  description: "Suivi de stages hiver 2027 — Montréal / Laval",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121411" },
  ],
};

// Intentionally static, with no DB-backed badge (e.g. a live "relances dues"
// count). The layout wraps every route, so any query here runs on every
// single request; if Postgres is down that query rejects on every request
// too, and in Next 16 dev/Turbopack that reliably corrupts the response
// stream (see lib/db.ts and instrumentation.ts) — even when caught, even
// outside the layout. Keeping the shell free of data fetching means the nav
// stays usable during a DB outage instead of going down with whatever page
// hit it. The count still lives on the offres page's own stat card.
const NAV: NavItem[] = [
  { href: "/", label: "Offres" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/board", label: "Board" },
  { href: "/followups", label: "Relances" },
  { href: "/resumes", label: "CV" },
  { href: "/answers", label: "Banque" },
  { href: "/jobs/new", label: "Ajouter" },
];

/** Applies the stored theme before first paint so the page never flashes. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('desk-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Aller au contenu
        </a>

        <div className="shell">
          <header className="rail">
            <Link href="/" className="brand">
              <span className="brand-mark">Internship Desk</span>
              <span className="brand-sub">Hiver 2027 · Ara G.</span>
            </Link>

            <Nav items={NAV} />

            <div className="rail-foot">
              <span className="rail-env">Mode assisté</span>
              <ThemeToggle />
            </div>
          </header>

          <main className="page" id="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
