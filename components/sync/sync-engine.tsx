"use client";

import { useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { startSync } from "@/lib/history/sync";
import type { SyncClient } from "@/lib/history/sync";

/**
 * Keeps the local playground history in sync with the account (`uis`) while a
 * session exists — local-first, debounced, fire-and-forget (plan Q7). Mounted
 * once inside the auth provider; renders nothing.
 */
export function SyncEngine() {
  const { user, loading } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (loading || !user) return;
    // The real client satisfies the slice structurally, but TS's checker
    // explodes instantiating supabase's generic query builders against the
    // narrow SyncClient (TS2589) — one cast at the single integration
    // point, same adapter-boundary precedent as lib/publish/publish.ts.
    return startSync(supabase as unknown as SyncClient, user.id);
  }, [loading, user, supabase]);

  return null;
}
