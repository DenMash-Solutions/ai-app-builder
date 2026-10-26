import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

// @next-codemod-ignore Cache Components adoption: this segment temporarily allows blocking.
// Remove this opt-out after verifying the segment passes validation without it.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The playground lives under the app shell (sidebar + account menu). The
 * per-entry routes (`/ui/[ref]`) inherit it; the public content routes
 * (landing, live, preview, auth) deliberately don't — they stay chrome-less.
 */
export default function UiLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
