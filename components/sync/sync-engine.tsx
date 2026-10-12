"use client";

import { useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { startSync } from "@/lib/history/sync";

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
    return startSync(supabase, user.id);
  }, [loading, user, supabase]);

  return null;
}
