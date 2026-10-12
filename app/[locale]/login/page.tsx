"use client";

import type { Spec } from "@json-render/core";
import { useLocale, useTranslations } from "next-intl";
import { AuthActions } from "@/components/auth/auth-actions";
import { useAuthedRedirect } from "@/components/auth/authed-redirect";
import { SpecPage } from "@/components/spec-page/spec-page";
import loginSpecJson from "@/lib/specs/login.spec.json";

// Committed spec (spec-mandate): structure only — copy and checks come from
// i18n via state injection.
const spec = loginSpecJson as unknown as Spec;

export default function LoginPage() {
  const t = useTranslations();
  const locale = useLocale();
  // Signed-in visitors never see the form: placeholder while the session
  // settles, then a redirect to `?next=` (or the playground).
  const redirecting = useAuthedRedirect();

  if (redirecting) {
    return (
      <main className="dot-grid flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
      </main>
    );
  }

  return (
    <SpecPage
      spec={spec}
      extraState={{
        locale,
        copy: {
          title: t("login.title"),
          description: t("login.description"),
          emailLabel: t("login.emailLabel"),
          emailPlaceholder: t("login.emailPlaceholder"),
          passwordLabel: t("login.passwordLabel"),
          submit: t("login.submit"),
          switchText: t("login.switchText"),
          switchLink: t("login.switchLink"),
        },
        checks: {
          emailRequired: t("auth.checks.emailRequired"),
          emailInvalid: t("auth.checks.emailInvalid"),
          passwordRequired: t("auth.checks.passwordRequired"),
          minLength: t("auth.checks.minLength"),
          passwordsMustMatch: t("auth.checks.passwordsMustMatch"),
        },
      }}
    >
      <AuthActions />
    </SpecPage>
  );
}
