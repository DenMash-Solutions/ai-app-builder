"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { HistoryEntry } from "@/lib/history";
import { isReservedSlug, isValidSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/client";
import {
  asPublishClient,
  isSlugAvailable,
  publishEntry,
  unpublishEntry,
} from "@/lib/publish/publish";
import type { PublishedPage } from "@/lib/publish/publish";

interface GoLiveDialogProps {
  entry: HistoryEntry;
  published: PublishedPage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new live state (null = taken offline). */
  onPublished: (published: PublishedPage | null) => void;
}

type SlugStatus = "invalid" | "reserved" | "checking" | "available" | "taken";

const STATUS_TEXT: Record<SlugStatus, string> = {
  invalid: "publish.invalid",
  reserved: "publish.reserved",
  checking: "publish.checking",
  available: "publish.available",
  taken: "publish.taken",
};

const STATUS_CLASS: Record<SlugStatus, string> = {
  invalid: "text-destructive",
  reserved: "text-destructive",
  checking: "text-muted-foreground",
  available: "text-emerald-600 dark:text-emerald-400",
  taken: "text-destructive",
};

/**
 * Go-live dialog: slug prefilled from the draft, debounced global
 * availability (domain-style, first to publish wins), then publish the
 * currently selected revision as a new immutable version. When already live:
 * shows the current version and can take the page offline.
 *
 * Content is mounted only while open, so every reopen starts from the
 * entry's draft slug without effect-driven state resets.
 */
export function GoLiveDialog(props: GoLiveDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <GoLiveContent {...props} />}
    </Dialog>
  );
}

function GoLiveContent({
  entry,
  published,
  onOpenChange,
  onPublished,
}: GoLiveDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user } = useAuth();
  const supabase = useMemo(() => asPublishClient(createClient()), []);
  const [slug, setSlug] = useState(published?.slug ?? entry.slug);
  const [check, setCheck] = useState<{
    slug: string;
    available: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = isValidSlug(slug);
  const reserved = isReservedSlug(slug);

  // Debounced availability probe. The status shown is *derived* below
  // (check.slug !== slug ⇒ still checking) — no setState in the effect body.
  useEffect(() => {
    if (!valid || reserved) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void isSlugAvailable(supabase, slug, entry.id).then((available) => {
        if (!cancelled) setCheck({ slug, available });
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, valid, reserved, supabase, entry.id]);

  const status: SlugStatus = !valid
    ? "invalid"
    : reserved
      ? "reserved"
      : check?.slug !== slug
        ? "checking"
        : check.available
          ? "available"
          : "taken";

  const canPublish = status === "available" && !busy && user !== null;

  const handleSubmit = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    const result = await publishEntry(supabase, user.id, entry, slug);
    setBusy(false);
    if (!result.ok) {
      if (result.slugTaken) {
        setCheck({ slug, available: false });
        toast.error(t("publish.takenToast"));
      } else {
        toast.error(t("publish.error"));
      }
      return;
    }
    toast.success(
      t("publish.published", {
        url: `${window.location.origin}/${locale}/${result.slug}`,
      }),
    );
    onPublished({
      uiId: entry.id,
      slug: result.slug ?? slug,
      version: result.version ?? (published?.version ?? 0) + 1,
    });
    onOpenChange(false);
  };

  const handleUnpublish = async (): Promise<void> => {
    setBusy(true);
    const result = await unpublishEntry(supabase, entry.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(t("publish.error"));
      return;
    }
    toast.success(t("publish.unpublishDone"));
    onPublished(null);
    onOpenChange(false);
  };

  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{t("publish.title", { name: entry.name })}</DialogTitle>
        <DialogDescription>
          {published
            ? t("publish.currentVersion", { version: published.version })
            : t("publish.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <label htmlFor="publish-slug" className="text-sm font-medium">
          {t("publish.slugLabel")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/{locale}/</span>
          <Input
            id="publish-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className={`text-xs ${STATUS_CLASS[status]}`} aria-live="polite">
          {t(STATUS_TEXT[status])}
        </p>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <div>
          {published && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void handleUnpublish()}
            >
              {t("publish.unpublish")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("historyDrawer.close")}
          </Button>
          <Button
            type="button"
            disabled={!canPublish}
            onClick={() => void handleSubmit()}
          >
            {busy
              ? t("publish.publishing")
              : published
                ? t("publish.update")
                : t("publish.submit")}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
