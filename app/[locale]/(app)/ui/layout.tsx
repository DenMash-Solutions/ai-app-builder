import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

/**
 * The playground lives under the app shell (sidebar + account menu). The
 * per-entry routes (`/ui/[ref]`) inherit it; the public content routes
 * (landing, live, preview, auth) deliberately don't — they stay chrome-less.
 */
export default function UiLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
