"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { CloudUpload } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { getHistory, subscribeHistory } from "@/lib/history/history";
import { flushSync } from "@/lib/history/sync";

const SEEN_FLAG = "genui-upload-nudge-seen";

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_FLAG) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_FLAG, "1");
  } catch {
    // Storage unavailable — the nudge may show again next session. Harmless.
  }
}

/**
 * First-login nudge: offers to push pre-existing local UIs to the new
 * account ("Upload now" flushes the sync immediately). Shown once per
 * browser; background auto-sync keeps running either way (plan Q7 is fully
 * auto — this is the visible shortcut, not a consent gate).
 */
export function UploadNudge() {
  const { user, loading } = useAuth();
  const t = useTranslations();
  const count = useSyncExternalStore(
    subscribeHistory,
    () => getHistory().length,
    () => 0,
  );
  const [seen, setSeen] = useState(readSeen);

  if (loading || !user || seen || count === 0) return null;

  const dismiss = () => {
    markSeen();
    setSeen(true);
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border bg-background/90 px-4 py-2 shadow-lg backdrop-blur-md">
      <CloudUpload aria-hidden="true" className="size-4 shrink-0" />
      <span className="text-sm">{t("sync.uploadNudge", { count })}</span>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          flushSync();
          dismiss();
        }}
      >
        {t("sync.uploadNow")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
        {t("sync.later")}
      </Button>
    </div>
  );
}
