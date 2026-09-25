import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono, Newsreader } from "next/font/google";
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

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// The optical-size axis lets titles use the display cut (finer hairlines,
// tighter spacing) while small serif text stays sturdy.
const display = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-display",
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
    { media: "(prefers-color-scheme: light)", color: "#f3f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0f0d" },
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
              {/* Grid areas place these: rail down the left edge with the
                  top bar beside it on desktop; stacked top bar, nav strip,
                  page below 1040px. DOM order stays the tab order. */}
              <div className="shell">
                <TopBar assistedMode={assistedMode} />

                <header className="rail">
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
                </header>

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
