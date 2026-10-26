import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components (plan 056): every route must be prerenderable; route
  // opt-outs (`export const instant = false`) are the adoption work queue.
  cacheComponents: true,
  // Native oxide scanner + the compile engine must not be bundled into the
  // /api/tailwind route (server-side on-demand Tailwind).
  serverExternalPackages: ["@tailwindcss/node", "@tailwindcss/oxide"],
};

export default withNextIntl(nextConfig);
