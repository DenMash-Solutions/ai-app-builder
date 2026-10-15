"use client";

import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { Button } from "@/components/ui/button";
import { appDirectives } from "@/lib/computed/directives";
import type { HistoryEntry } from "@/lib/history";
import { getHistory, subscribeHistory } from "@/lib/history";
import { Link } from "@/lib/i18n/navigation";
import {
  availableLanguages,
  mergeI18n,
  SPEC_STATE_KEYS,
} from "@/lib/i18n/spec-languages";
import { LOCALES, routing } from "@/lib/i18n/routing";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import type { LivePageData } from "@/lib/publish/featured";
import { localizeSpec } from "@/lib/specs/localize";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { ArrowUpRight } from "lucide-react";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

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
  bakedCss,
}: {
  published: LivePageData | null;
  /** Publish-baked stylesheet for the published spec — kills the FOUC. */
  bakedCss?: string | null;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const entry = useSyncExternalStore<HistoryEntry | null | undefined>(
    subscribeHistory,
    () => getHistory().find((candidate) => candidate.slug === slug) ?? null,
    // Server snapshot = pending (history is localStorage-only).
    () => undefined,
  );

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

  // Route locale = content language (same merge as the live page).
  const merged = mergeI18n(spec.state, locale) ?? {};
  // The design's switcher highlights state.locale — keep it on the language
  // this route actually serves (runtime diff only; the stored spec's seed
  // marker is never written).
  const state =
    SPEC_STATE_KEYS.locale in merged
      ? { ...merged, [SPEC_STATE_KEYS.locale]: locale }
      : merged;
  const localized = localizeSpec(spec, state);

  // The switcher writes state.locale; on a route-driven surface that means
  // "serve this language from its URL" — navigate instead of merging in
  // place (decisions 5 and 11). Only real languages the spec carries count.
  const handleStateChange = (
    changes: Array<{ path: string; value: unknown }>,
  ) => {
    const change = changes.find(
      (candidate) =>
        candidate.path.replace(/^\//, "") === SPEC_STATE_KEYS.locale,
    );
    if (!change) return;
    const tag = change.value;
    if (typeof tag !== "string" || tag === locale) return;
    if (!availableLanguages(spec).includes(tag)) return;
    router.push(`/${tag}/${slug}`);
  };

  // The preview pill points at the playground: in the app's languages, and
  // pinned to a routable one so it can never link into a 404 from a
  // content-only locale (decision 11).
  const pillLocale = hasLocale(LOCALES, locale)
    ? locale
    : routing.defaultLocale;

  // Tab title from the resolved name. React 19 hoists this client-rendered
  // <title> into <head> and lets it win over the layout's metadata title —
  // declaratively, so it can't fight the head manager the way the old
  // imperative `document.title` + head MutationObserver did (that observer
  // watched <head> subtree and wrote back into it, wedging the main thread
  // in a synchronous loop on some entries).
  const entryName = entry?.name ?? published?.name;

  return (
    <JSONUIProvider
      registry={registry}
      initialState={state}
      onStateChange={handleStateChange}
      handlers={{}}
      validationFunctions={{}}
      directives={appDirectives}
    >
      {/* Bare surface: no background, chrome, or layout padding — the
                spec renders as-is; only the floating pill sits on top. */}
      <main className="relative w-full">
        {entryName ? <title>{entryName}</title> : null}
        {bakedCss ? <style>{bakedCss}</style> : null}
        <Renderer spec={fixupScrollLayout(localized)} registry={registry} />
        <Button asChild className="fixed bottom-4 right-4 z-50 shadow-lg">
          {/* The owner's local copy opens in their playground; a purely
                    public visit lands on the playground landing instead. */}
          <Link href={entry ? `/ui/${entry.slug}` : "/ui"} locale={pillLocale}>
            <ArrowUpRight aria-hidden="true" className="size-4" />
            {t("preview.openPlayground")}
          </Link>
        </Button>
      </main>
    </JSONUIProvider>
  );
}
