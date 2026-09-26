import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { CommandPaletteProvider } from "./components/command-palette";
import { NAV_ITEMS } from "./components/nav-items";
import { Nav } from "./components/nav";
import { ToastProvider } from "./components/toaster";
import { TooltipProvider } from "./components/client-ui";
import { TopBar } from "./components/topbar";
import { IconBrand } from "./components/icons";
import { assistedModeDefault } from "../lib/sources";
import { getDeskOwner } from "../lib/desk-owner";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: { default: "Internship Desk", template: "%s · Internship Desk" },
  description: "Suivi de stages hiver 2027 · Montréal / Laval",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

/** Applies the stored theme before first paint so the page never flashes.
 *  Light (v4) is the default identity; only an explicit stored "dark" choice
 *  switches away. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('desk-theme');document.documentElement.dataset.theme=(t==='dark'||t==='light')?t:'light'}catch(e){document.documentElement.dataset.theme='light'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // A pure env-var read, not a DB query — safe in the layout even during a
  // Postgres outage (see the NAV_ITEMS comment in nav-items.ts for why
  // anything DB-backed stays out of this file).
  const assistedMode = assistedModeDefault();
  const owner = getDeskOwner();

  return (
    <html
      lang="fr"
      className={`${sans.variable} ${mono.variable}`}
      data-theme="light"
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

        <ToastProvider>
          <TooltipProvider>
            <CommandPaletteProvider>
              {/* Grid areas place these: rail down the left edge with the
                  top bar beside it on desktop; stacked top bar, nav strip,
                  page below 1040px. DOM order stays the tab order. */}
              <div className="shell">
                <TopBar assistedMode={assistedMode} owner={owner} />

                <aside className="rail" aria-label="Navigation principale">
                  <Link href="/" className="brand">
                    <span className="brand-logo">
                      <IconBrand />
                    </span>
                    <span className="brand-text">
                      <span className="brand-mark">
                        Internship <em>Desk</em>
                      </span>
                      <span className="brand-sub">Stages hiver 2027</span>
                    </span>
                  </Link>

                  <Nav items={NAV_ITEMS} />
                </aside>

                <main className="page" id="main">
                  {children}
                </main>
              </div>
            </CommandPaletteProvider>
          </TooltipProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
