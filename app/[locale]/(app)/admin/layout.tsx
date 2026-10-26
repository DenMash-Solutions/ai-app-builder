import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

/** The admin console sits inside the app shell, like the playground. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
