"use client";

import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { QueryLoader } from "@/components/data-sources/query-loader";
import { SpecThemeInit } from "@/components/spec-theme-init";
import { Button } from "@/components/ui/button";
import { appDirectives } from "@/lib/computed/directives";
import type { HistoryEntry } from "@/lib/history";
import { getHistory, subscribeHistory } from "@/lib/history";
import {
  SWITCH_LANGUAGE_ACTION,
  hasSwitchLanguageBinding,
} from "@/lib/i18n/language-switcher";
import { Link } from "@/lib/i18n/navigation";
import {
  availableLanguages,
  mergeI18n,
  SPEC_STATE_KEYS,
} from "@/lib/i18n/spec-languages";
import { LOCALES, routing } from "@/lib/i18n/routing";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import type { LivePageData } from "@/lib/publish/featured";
import { localizeSpec } from "@/lib/specs/localize";
import {
  SWITCH_THEME_ACTION,
  SPEC_THEME_STATE_KEY,
  effectiveTheme,
  isTheme,
  persistThemeDecision,
  readStoredDecision,
  specTheme,
} from "@/lib/theme/spec-theme";
import { JSONUIProvider, Renderer, useStateValue } from "@json-render/react";
import { ArrowUpRight } from "lucide-react";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore, useRef } from "react";

/**
 * Keeps <html>'s `dark` class on the design's theme while this chrome-less
 * route is open — the provider seeds `state.theme` with the EFFECTIVE theme
 * (stored decision > spec default), so following the state is following the
 * one rule; pre-paint scripts already painted the first frame. Renders
 * inside the JSONUIProvider to subscribe to the theme state.
 */
function ThemeHtmlSync() {
  const theme = useStateValue<string>(`/${SPEC_THEME_STATE_KEY}`);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return null;
}

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

  const spec = entry?.spec ?? published?.spec ?? null;

  // Runtime classes: spec classNames exist only at runtime — compile any not
  // yet covered via /api/tailwind (same no-op-on-failure behavior as the
  // playground; the hook is session-cached so revisits cost nothing).
  useRuntimeClasses(spec);

  // The spec-declared switch (decision 13): the toggle's change event hands
  // the pressed tag to this handler, and this route-driven surface
  // navigates instead of merging in place (decisions 5 and 11). Handlers
  // must be stable-once — ActionProvider captures its initial handlers — so
  // the handler lives behind a ref that an effect re-syncs each render (a
  // stale closure would guard with the previous route's locale after a
  // switch; the effect ref always reflects the committed page state).
  const switchRef = useRef<(params: Record<string, unknown>) => void>(() => {});
  useEffect(() => {
    switchRef.current = (params) => {
      if (!spec) return;
      const tag = params.tag;
      if (typeof tag !== "string" || tag === locale) return;
      if (!availableLanguages(spec).includes(tag)) return;
      router.push(`/${tag}/${slug}`);
    };
  });
  const handlers = useMemo(
    () => ({
      [SWITCH_LANGUAGE_ACTION]: (params: Record<string, unknown>) =>
        switchRef.current(params),
      [SWITCH_THEME_ACTION]: (params: Record<string, unknown>) =>
        themeRef.current(params),
    }),
    [],
  );

  // Spec-driven theme (decision D3): this chrome-less route themes <html>
  // for BOTH audiences (decision > spec default, seeded above) — the page
  // IS the design. Only persistence splits: serving the published projection
  // is PUBLIC, so the toggle writes the visitor's decision site-wide; an
  // owner toggling their local entry is session view state — the spec's
  // default owns what comes back on reload. Handler stays stable-once behind
  // a re-synced ref.
  const themeRef = useRef<(params: Record<string, unknown>) => void>(() => {});
  useEffect(() => {
    themeRef.current = (params) => {
      if (entry !== null || !published) return;
      if (!isTheme(params.theme)) return;
      persistThemeDecision(params.theme);
    };
  });

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

  if (!spec) return null;

  // Route locale = content language (same merge as the live page).
  const merged = mergeI18n(spec.state, locale) ?? {};
  // The design's switcher highlights state.locale — keep it on the language
  // this route actually serves (runtime diff only; the stored spec's seed
  // marker is never written).
  const baseState =
    SPEC_STATE_KEYS.locale in merged
      ? { ...merged, [SPEC_STATE_KEYS.locale]: locale }
      : merged;
  // Spec-driven theme seeding: the visitor's stored decision beats the spec
  // default (decision D3) — but only on the CLIENT, where storage exists;
  // SSR renders the spec default and the pre-paint scripts below (ThemeInit
  // for a stored decision, SpecThemeInit for the default) already painted
  // <html> before hydration corrects the switcher's icon.
  const specDefault = specTheme(baseState);
  const storedDecision = specDefault !== null ? readStoredDecision() : null;
  const state =
    specDefault === null
      ? baseState
      : {
          ...baseState,
          [SPEC_THEME_STATE_KEY]: effectiveTheme(storedDecision, specDefault),
        };
  const localized = localizeSpec(spec, state);

  // The state-write fallback (decision 13): specs that predate the declared
  // switch still navigate by writing state.locale — but once the toggle
  // binds switch_language the action owns navigation and this would
  // double-push, so it stays off.
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
      onStateChange={
        hasSwitchLanguageBinding(spec) ? undefined : handleStateChange
      }
      handlers={handlers}
      validationFunctions={{}}
      // Same computed-function set as the playground and live pages — without
      // it, `$computed` props (filterItems/sliceItems/stepPage/pageLabel)
      // render unresolved on this surface.
      functions={PLAYGROUND_FUNCTIONS}
      directives={appDirectives}
    >
      {/* Data sources runtime (docs/plan/data-sources, D6/D8): the slug
                  scopes this design's records — owner preview and published
                  visitor share one per-browser store for the same design. */}
      <QueryLoader spec={spec} namespace={slug} />
      {/* Bare surface: no background, chrome, or layout padding — the
                spec renders as-is; only the floating pill sits on top. */}
      <ThemeHtmlSync />
      <main className="relative w-full">
        {/* Pre-paint: the spec's dark default applies only when the visitor
                carries no stored decision (ThemeInit in the layout applies
                one) — rendered whenever a published page is being served, so
                it lands in the server HTML. */}
        {published ? <SpecThemeInit specDefault={specDefault} /> : null}
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
