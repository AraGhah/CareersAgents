import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { CommandPaletteProvider } from "./components/command-palette";
import { NAV_ITEMS } from "./components/nav-items";
import { Nav } from "./components/nav";
import { ToastProvider } from "./components/toaster";
import { TooltipProvider } from "./components/client-ui";
import { TopBar } from "./components/topbar";
import { assistedModeDefault } from "../lib/sources";

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
  description: "Suivi de stages hiver 2027 · Montréal / Laval",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e0b" },
  ],
};

/** Applies the stored theme before first paint so the page never flashes.
 *  Dark is the default identity: only an explicit stored "light" choice
 *  ever sets the attribute here — everything else falls through to the CSS
 *  default (dark), except a first-time OS light preference (handled in CSS). */
const THEME_SCRIPT = `try{var t=localStorage.getItem('desk-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // A pure env-var read, not a DB query — safe in the layout even during a
  // Postgres outage (see the NAV_ITEMS comment in nav-items.ts for why
  // anything DB-backed stays out of this file).
  const assistedMode = assistedModeDefault();

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

        <ToastProvider>
          <TooltipProvider>
            <CommandPaletteProvider>
              <div className="shell">
                <TopBar assistedMode={assistedMode} />

                <div className="shell-body">
                  <header className="rail">
                    <Link href="/" className="brand">
                      <span className="brand-mark">Internship Desk</span>
                      <span className="brand-sub">Hiver 2027 · Ara G.</span>
                    </Link>

                    <Nav items={NAV_ITEMS} />

                    <div className="rail-foot">
                      <span>Trouver une page</span>
                      <kbd>⌘K</kbd>
                    </div>
                  </header>

                  <main className="page" id="main">
                    {children}
                  </main>
                </div>
              </div>
            </CommandPaletteProvider>
          </TooltipProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
