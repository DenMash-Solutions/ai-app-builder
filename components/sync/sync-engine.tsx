"use client";

import { useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { startTemplateSeeding } from "@/lib/catalog/catalog";
import { createClient } from "@/lib/supabase/client";
import {
  catalogAssetsSyncSpec,
  catalogInstallsSyncSpec,
  catalogVersionsSyncSpec,
  membershipsSyncSpec,
  projectsSyncSpec,
  startSync,
  startTableSync,
} from "@/lib/history/sync";
import type { SyncClient } from "@/lib/history/sync";

/**
 * Keeps the local playground history (`uis`), projects (`projects`),
 * project memberships (`project_screens`) and the UI catalog
 * (`catalog_assets` / `catalog_asset_versions` / `catalog_installs`, plan
 * 066 decision 9) in sync with the account while a session exists —
 * local-first, debounced, fire-and-forget (plan Q7 + 064 + 065 + 066).
 * Six loops, but one status dot and one `flushSync` path: all live in
 * `lib/history/sync.ts` (064 decision 1).
 *
 * This is also the signed-in seam for the template→catalog seed (066
 * decision 5): the existing localStorage library migrates once per storage
 * (idempotent) and saves made while the session lasts mirror into catalog
 * rows; sign-out unregisters the listener again.
 * Mounted once inside the auth provider; renders nothing.
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
    const client = supabase as unknown as SyncClient;
    const stopSeeding = startTemplateSeeding();
    const stops = [
      startSync(client, user.id),
      startTableSync(client, user.id, projectsSyncSpec),
      startTableSync(client, user.id, membershipsSyncSpec),
      startTableSync(client, user.id, catalogAssetsSyncSpec),
      startTableSync(client, user.id, catalogVersionsSyncSpec),
      startTableSync(client, user.id, catalogInstallsSyncSpec),
    ];
    return () => {
      stops.forEach((stop) => stop());
      stopSeeding();
    };
  }, [loading, user, supabase]);

  return null;
}
