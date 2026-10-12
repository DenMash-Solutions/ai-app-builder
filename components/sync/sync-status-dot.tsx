"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { getSyncStatus, subscribeSyncStatus } from "@/lib/history/sync";
import type { SyncStatus } from "@/lib/history/sync";

const DOT_CLASS: Record<SyncStatus, string> = {
  idle: "bg-muted-foreground/40",
  syncing: "animate-pulse bg-amber-500",
  saved: "bg-emerald-500",
  offline: "bg-red-500",
};

/**
 * Account-sync status dot (Saved to account / Syncing / Offline) — visible
 * only while signed in; state comes from the sync engine's external store.
 */
export function SyncStatusDot() {
  const { user, loading } = useAuth();
  const t = useTranslations();
  const status = useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatus,
    () => "idle" as SyncStatus,
  );

  if (loading || !user) return null;

  return (
    <span
      role="status"
      aria-label={t(`sync.status.${status}`)}
      title={t(`sync.status.${status}`)}
      className={`size-2.5 shrink-0 rounded-full ${DOT_CLASS[status]}`}
    />
  );
}
