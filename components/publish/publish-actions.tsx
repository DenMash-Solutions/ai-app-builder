"use client";

import { useLocale, useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HistoryEntry } from "@/lib/history";
import { Link } from "@/lib/i18n/navigation";
import type { PublishedPage } from "@/lib/publish/publish";

interface PublishActionsProps {
  entry: HistoryEntry;
  published: PublishedPage | null;
  onGoLive: () => void;
}

/**
 * Per-row publish affordance (user: "for now we use history"):
 * - anonymous → signup CTA (publishing requires an account)
 * - draft → "Go live" globe button
 * - live → "Live" badge linking to the public URL + globe to manage
 */
export function PublishActions({
  entry,
  published,
  onGoLive,
}: PublishActionsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Link href="/signup" aria-label={t("publish.signupCta")}>
          <Globe aria-hidden="true" className="size-3.5" />
          <span className="ml-1 text-xs">{t("publish.signupShort")}</span>
        </Link>
      </Button>
    );
  }

  return (
    <>
      {published && (
        <Button asChild variant="ghost" size="sm" className="h-7 px-2">
          <a
            href={`/${locale}/${published.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("publish.openLive", { name: entry.name })}
          >
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/50 px-1.5 text-emerald-600 dark:text-emerald-400"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-emerald-500"
              />
              {t("publish.liveBadge")}
            </Badge>
          </a>
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={
          published
            ? t("publish.manageLive")
            : t("publish.goLive", { name: entry.name })
        }
        className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onGoLive}
      >
        <Globe aria-hidden="true" className="size-3.5" />
      </Button>
    </>
  );
}
