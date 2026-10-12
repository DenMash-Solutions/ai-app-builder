"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { getHistory, subscribeHistory } from "@/lib/history/history";
import { Link } from "@/lib/i18n/navigation";

const DISMISSED_FLAG = "genui-signup-banner-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Anonymous conversion banner on the playground landing: local-only UIs are
 * one signup away from surviving this browser. Dismissal is remembered.
 */
export function SignupBanner() {
  const { user, loading } = useAuth();
  const t = useTranslations();
  const count = useSyncExternalStore(
    subscribeHistory,
    () => getHistory().length,
    () => 0,
  );
  const [dismissed, setDismissed] = useState(readDismissed);

  if (loading || user !== null || dismissed || count === 0) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_FLAG, "1");
    } catch {
      // Storage unavailable — dismissal lasts this session only.
    }
    setDismissed(true);
  };

  return (
    <div className="absolute inset-x-4 top-24 z-20 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border bg-background/90 px-4 py-2 shadow-lg backdrop-blur-md">
      <span className="text-sm">{t("signupBanner.text")}</span>
      <Button asChild type="button" size="sm">
        <Link href="/signup">{t("signupBanner.cta")}</Link>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("signupBanner.dismiss")}
        onClick={dismiss}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
