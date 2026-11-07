import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components (plan 056): every route must be prerenderable; route
  // opt-outs (`export const instant = false`) are the adoption work queue.
  cacheComponents: true,
  // Screen-to-screen navigation must feel instant: reuse the client Router
  // Cache instead of re-fetching the RSC payload on every push. `dynamic`
  // defaults to 0 (no reuse) since Next 15, which made every project screen
  // navigation a fresh server round trip (`?_rsc=…`).
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  // Native oxide scanner + the compile engine must not be bundled into the
  // /api/tailwind route (server-side on-demand Tailwind).
  serverExternalPackages: ["@tailwindcss/node", "@tailwindcss/oxide"],
  // E2E only (plan 065 Task 5): streaming metadata renders Next's
  // `MetadataWrapper` as `<div hidden>`; when it mounts, React's hide
  // cascade (`hideInstance` → `hideOrUnhideNearestPortals`) copies
  // `display: none !important` onto open Radix portals (popover/drawer/
  // dialog), which then measure 0×0 and stall Playwright visibility waits.
  // Opt EVERY request out of streaming metadata removes the wrapper
  // entirely — `htmlLimitedBots` REPLACES Next's default bot list, and this
  // branch only exists when Playwright starts the server (PLAYWRIGHT_TEST),
  // so production keeps streaming metadata and the default bot list.
  ...(process.env.PLAYWRIGHT_TEST === "true" ? { htmlLimitedBots: /.*/ } : {}),
};

export default withNextIntl(nextConfig);
