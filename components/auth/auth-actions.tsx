"use client";

import { useEffect, useMemo, useRef } from "react";
import { useActions, useStateStore } from "@json-render/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/auth/next-path";
import { createClient } from "@/lib/supabase/client";
import { checkUsername } from "@/lib/usernames";
import { fetchUsernameAvailable } from "@/lib/usernames-rpc";

type Translate = (key: string) => string;

/** How long a keystroke waits before asking the server (plan 068 decision 3). */
const USERNAME_CHECK_DEBOUNCE_MS = 350;

/** Supabase hides trigger failures behind this message; the unique index on
 *  `profiles.username` is what actually rejects a taken handle at signup. */
function isSignupConflict(message: string): boolean {
  return message.toLowerCase().includes("database error saving new user");
}

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
  // Latest-keystroke-wins guard for the debounced availability check.
  const checkSeq = useRef(0);

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
      router.push(safeNextPath() ?? `/${locale}/ui`);
    });

    // Advisory, debounced: the claim at signup is what decides the handle, so
    // this only tells the user early whether the name is free.
    registerHandler("auth.checkUsername", async (params) => {
      const { username, issue } = checkUsername(String(params.username ?? ""));
      checkSeq.current += 1;
      const mine = checkSeq.current;
      if (issue) {
        store.set("/auth/usernameStatus", "invalid");
        store.set("/auth/usernameError", t(`username.issues.${issue}`));
        return;
      }
      store.set("/auth/usernameStatus", "checking");
      store.set("/auth/usernameError", "");
      await new Promise((resolve) =>
        setTimeout(resolve, USERNAME_CHECK_DEBOUNCE_MS),
      );
      if (checkSeq.current !== mine) return;
      const available = await fetchUsernameAvailable(supabase, username);
      if (checkSeq.current !== mine) return;
      if (available === false) {
        store.set("/auth/usernameStatus", "taken");
        store.set("/auth/usernameError", t("username.issues.taken"));
        return;
      }
      store.set("/auth/usernameStatus", available ? "available" : "unknown");
      store.set("/auth/usernameError", "");
    });

    registerHandler("auth.signup", async (params) => {
      const email = String(params.email ?? "").trim();
      const password = String(params.password ?? "");
      const { username, issue } = checkUsername(String(params.username ?? ""));
      store.set("/auth/error", "");
      if (issue) {
        store.set("/auth/error", t(`username.issues.${issue}`));
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Plan 068: the signup trigger writes this into profiles.username.
          data: { username },
          // Where the confirmation link lands after the user verifies.
          emailRedirectTo: `${window.location.origin}/${locale}/ui`,
        },
      });
      if (error) {
        if (isSignupConflict(error.message)) {
          // The trigger's unique index refused the handle; say which field.
          const available = await fetchUsernameAvailable(supabase, username);
          store.set(
            "/auth/error",
            available === false
              ? t("username.issues.taken")
              : authErrorMessage(t, error.message),
          );
          return;
        }
        store.set("/auth/error", authErrorMessage(t, error.message));
        return;
      }
      if (data.session) {
        // Email confirmation disabled on this project — straight in.
        router.push(safeNextPath() ?? `/${locale}/ui`);
        return;
      }
      store.set("/auth/sent", true);
    });
  }, [registerHandler, store, t, router, locale, supabase]);

  return null;
}
