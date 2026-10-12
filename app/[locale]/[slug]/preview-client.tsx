"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
} from "@json-render/react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { Link } from "@/lib/i18n/navigation";
import { getHistory, subscribeHistory } from "@/lib/history";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import type { HistoryEntry } from "@/lib/history";
import type { LivePageData } from "@/lib/publish/featured";

/**
 * Read-only preview at /{locale}/{slug}: the entry's spec rendered with the
 * playground's catalog — no prompt bar, editor, tools, or overlays — plus a
 * floating pill back into the playground. Resolution mirrors /ui/[ref]
 * (localStorage-only store → client-side after hydration).
 *
 * The owner's local entry always wins; when there is none (fresh browser,
 * anonymous visitor), the server-fetched `published` projection renders the
 * live page instead — that is what makes a published URL public.
 */
export default function PreviewPage({
  published,
}: {
  published: LivePageData | null;
}) {
  const { slug } = useParams<{ slug: string }>();
  const t = useTranslations();
  const entry = useSyncExternalStore<HistoryEntry | null | undefined>(
    subscribeHistory,
    () => getHistory().find((candidate) => candidate.slug === slug) ?? null,
    // Server snapshot = pending (history is localStorage-only).
    () => undefined,
  );
  const entryName = entry?.name ?? published?.name;

  useEffect(() => {
    if (!entryName) return;
    const apply = () => {
      if (document.title !== entryName) document.title = entryName;
    };
    // The layout's metadata title is applied by Next's head manager at the
    // end of hydration — AFTER this page's effects, so a plain assignment
    // gets clobbered. The manager mutates the <title> element; watch for it
    // and re-assert. (Our own assignment re-triggers the observer, but the
    // guard makes that a no-op — no loop.)
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true });
    apply();
    return () => observer.disconnect();
  }, [entryName]);

  // Runtime classes: spec classNames exist only at runtime — compile any not
  // yet covered via /api/tailwind (same no-op-on-failure behavior as the
  // playground; the hook is session-cached so revisits cost nothing).
  useRuntimeClasses(entry?.spec ?? published?.spec ?? null);

  if (entry === undefined && !published) {
    return (
      <main className="dot-grid flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("uiRoute.loading")}</p>
      </main>
    );
  }

  if (entry === null && !published) {
    return (
      <main className="dot-grid flex h-[100dvh] w-full items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">
            {t("uiRoute.notFound.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("uiRoute.notFound.description")}
          </p>
          <Button asChild>
            <Link href="/">{t("uiRoute.notFound.back")}</Link>
          </Button>
        </div>
      </main>
    );
  }

  const spec = entry?.spec ?? published?.spec;
  if (!spec) return null;

  return (
    <StateProvider initialState={spec.state ?? {}}>
      <VisibilityProvider>
        <ActionProvider handlers={{}}>
          <ValidationProvider customFunctions={{}}>
            {/* Bare surface: no background, chrome, or layout padding — the
                spec renders as-is; only the floating pill sits on top. */}
            <main className="relative w-full">
              <Renderer spec={fixupScrollLayout(spec)} registry={registry} />
              <Button asChild className="fixed bottom-4 right-4 z-50 shadow-lg">
                {/* The owner's local copy opens in their playground; a purely
                    public visit lands on the playground landing instead. */}
                <Link href={entry ? `/ui/${entry.slug}` : "/ui"}>
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                  {t("preview.openPlayground")}
                </Link>
              </Button>
            </main>
          </ValidationProvider>
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
