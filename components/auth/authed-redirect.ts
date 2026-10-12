"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { safeNextPath } from "@/lib/auth/next-path";

/**
 * Keeps already-signed-in visitors off the auth pages: as soon as the
 * session settles they're sent to `?next=` (or the playground). Returns
 * whether the page should show a placeholder instead of the form — true
 * while the session is unknown AND after it resolves to "signed in", so a
 * signed-in visitor never sees the form flash.
 */
export function useAuthedRedirect(): boolean {
  const { user, loading } = useAuth();
  const router = useRouter();
  const locale = useLocale();
  const authed = !loading && user !== null;

  useEffect(() => {
    if (authed) router.replace(safeNextPath() ?? `/${locale}/ui`);
  }, [authed, router, locale]);

  return loading || authed;
}
