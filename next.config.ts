import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The floating dev-mode badge sits in the same corner as the new top bar's
  // account menu and overlaps it — off since it adds nothing in this shell.
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
