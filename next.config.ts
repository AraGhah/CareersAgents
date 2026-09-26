import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The floating dev-mode badge sits in the same corner as the new top bar's
  // account menu and overlaps it — off since it adds nothing in this shell.
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  // Company pages that refuse plain requests are opened in a headless browser (lib/contact-discovery.ts);
  // the server must load Playwright as is, not bundle it.
  serverExternalPackages: ["playwright", "playwright-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
