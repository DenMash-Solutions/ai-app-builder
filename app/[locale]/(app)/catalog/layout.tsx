import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

/**
 * Marketplace routes (plan 073): the browse and detail surfaces live under
 * the app shell (sidebar + account menu) like the playground — discovery is
 * a first-class, linkable surface, never a dialog.
 */
export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
