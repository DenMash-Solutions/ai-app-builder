"use client";

import type { Spec } from "@json-render/core";
import { useLocale, useTranslations } from "next-intl";
import { AuthActions } from "@/components/auth/auth-actions";
import { useAuthedRedirect } from "@/components/auth/authed-redirect";
import { SpecPage } from "@/components/spec-page/spec-page";
import signupSpecJson from "@/lib/specs/signup.spec.json";

// Committed spec (spec-mandate): structure only — copy and checks come from
// i18n via state injection.
const spec = signupSpecJson as unknown as Spec;

export default function SignupPage() {
  const t = useTranslations();
  const locale = useLocale();
  // Same as login: signed-in visitors are bounced (see useAuthedRedirect).
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
          title: t("signup.title"),
          description: t("signup.description"),
          emailLabel: t("signup.emailLabel"),
          emailPlaceholder: t("signup.emailPlaceholder"),
          passwordLabel: t("signup.passwordLabel"),
          confirmLabel: t("signup.confirmLabel"),
          submit: t("signup.submit"),
          switchText: t("signup.switchText"),
          switchLink: t("signup.switchLink"),
          sentText: t("signup.sentText"),
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
