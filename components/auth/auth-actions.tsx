"use client";

import { useEffect, useMemo } from "react";
import { useActions, useStateStore } from "@json-render/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Translate = (key: string) => string;

/** Maps Supabase auth error signatures to localized copy. */
function authErrorMessage(t: Translate, message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("invalid login") ||
    normalized.includes("invalid_credentials")
  ) {
    return t("auth.errors.invalidCredentials");
  }
  if (
    normalized.includes("already registered") ||
    normalized.includes("user_already_exists") ||
    normalized.includes("already been registered")
  ) {
    return t("auth.errors.emailTaken");
  }
  if (normalized.includes("weak_password")) {
    return t("auth.errors.weakPassword");
  }
  return t("auth.errors.generic");
}

/**
 * Wires the auth specs' `auth.login` / `auth.signup` actions to Supabase.
 * Rendered inside SpecPage's providers: `registerHandler` + `useStateStore`
 * give the handlers access to the spec state model (error / sent fields).
 */
export function AuthActions() {
  const { registerHandler } = useActions();
  const store = useStateStore();
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    registerHandler("auth.login", async (params) => {
      const email = String(params.email ?? "").trim();
      const password = String(params.password ?? "");
      store.set("/auth/error", "");
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        store.set("/auth/error", authErrorMessage(t, error.message));
        return;
      }
      router.push(`/${locale}/ui`);
    });

    registerHandler("auth.signup", async (params) => {
      const email = String(params.email ?? "").trim();
      const password = String(params.password ?? "");
      store.set("/auth/error", "");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Where the confirmation link lands after the user verifies.
          emailRedirectTo: `${window.location.origin}/${locale}/ui`,
        },
      });
      if (error) {
        store.set("/auth/error", authErrorMessage(t, error.message));
        return;
      }
      if (data.session) {
        // Email confirmation disabled on this project — straight in.
        router.push(`/${locale}/ui`);
        return;
      }
      store.set("/auth/sent", true);
    });
  }, [registerHandler, store, t, router, locale, supabase]);

  return null;
}
