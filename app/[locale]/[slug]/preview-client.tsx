"use client";

import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { QueryLoader } from "@/components/data-sources/query-loader";
import { NavigateHandler } from "@/components/projects/navigate-handler";
import { SessionSync } from "@/components/projects/session-sync";
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
import {
  overlayUrlState,
  specUrlSync,
  urlSearchAfterStateChange,
} from "@/lib/playground/url-sync";
import { getProjects, projectBySlug } from "@/lib/projects/projects";
import { screenScope } from "@/lib/projects/screen-nav";
import {
  dataNamespaceFor,
  omitSessionState,
} from "@/lib/projects/session-state";
import {
  matchRoutePattern,
  overlayPathState,
  projectHomeScreenId,
  resolveProjectRoute,
  specRoutePattern,
} from "@/lib/projects/screen-routes";
import type { LivePageData } from "@/lib/publish/featured";
import type { LiveProjectPage } from "@/lib/publish/live-project";
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
  routePath,
  liveProject,
}: {
  published: LivePageData | null;
  /** Publish-baked stylesheet for the published spec — kills the FOUC. */
  bakedCss?: string | null;
  /**
   * Post-slug path from the `[[...route]]` catch-all (`"4"`, `"settings"`),
   * null when bare. Resolved client-side below — entries and projects are
   * device-local, so the server can only hand the segments over (061-3 §A).
   */
  routePath?: string | null;
  /**
   * Server-resolved project HANDLE route (plan 069 task 4, decision 17/18):
   * the server already matched the path against the published snapshot and
   * 404d the misses, so this prop arrives only when the path serves. Local
   * resolution still wins below — the author's device holds the project.
   */
  liveProject?: LiveProjectPage | null;
}) {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const t = useTranslations();
  const locale = useLocale();
  const history = useSyncExternalStore<HistoryEntry[] | undefined>(
    subscribeHistory,
    getHistory,
    // Server snapshot = pending (history is localStorage-only).
    () => undefined,
  );
  const localEntry =
    history?.find((candidate) => candidate.slug === slug) ?? null;

  // Resolution (061-3, §A): what serves /{locale}/{slug}[/{route}]?
  //  1. the local entry by slug — with a path, its own spec-level `route`
  //     pattern must match it (flat entry paths are a real shape: they are
  //     what buildNavigateRoute pushes for project-less targets),
  //  2. else the project namespace — bare serves the EXPLICIT home screen
  //     (`project.homeScreenId`, 065 decision 5), a path resolves
  //     in-project (membership routes: exact slug, static, dynamic, pos),
  //  3. else the server-resolved live HANDLE route (069, decision 17/18):
  //     the snapshot row the page matched — local wins when the device
  //     holds the project, looked up by slug OR by id (the handle may
  //     differ from the slug after a handle change),
  //  4. else the published projection, BARE ONLY: a path under an unknown
  //     namespace is a 404, not a fallback.
  // A path nothing claims (or a project with no members) gates as not-found —
  // never a wrong screen, which would seed the wrong state.
  let entry: HistoryEntry | null | undefined = undefined; // undefined = pending
  // The server already captured the live route's params — the seed applies
  // during SSR and survives until local resolution (if any) replaces it.
  let pathParams: Record<string, string> | null = liveProject?.params ?? null;
  let unmatched = false;
  if (history !== undefined) {
    entry = localEntry;
    // A local project claims the handle namespace by slug — or by id when
    // the handle no longer equals the slug (handle change, decision 4).
    const project =
      localEntry !== null
        ? null
        : (projectBySlug(slug) ??
          (liveProject
            ? (getProjects().find(
                (candidate) => candidate.id === liveProject.projectId,
              ) ?? null)
            : null));
    const localClaimant = localEntry !== null || project !== null;
    if (routePath) {
      const pattern = localEntry ? specRoutePattern(localEntry.spec) : null;
      const flat =
        localEntry && pattern ? matchRoutePattern(pattern, routePath) : null;
      const match =
        flat !== null
          ? { screen: localEntry, params: flat }
          : localEntry
            ? null
            : project
              ? resolveProjectRoute(project, history, routePath)
              : null;
      if (match && match.screen) {
        entry = match.screen;
        pathParams = match.params;
      } else if (localClaimant) {
        unmatched = true;
        entry = null;
      } else if (liveProject) {
        // Server-resolved and nothing local competes — serve the snapshot.
        entry = null;
        pathParams = liveProject.params;
      } else {
        unmatched = true;
        entry = null;
      }
    } else if (!localEntry && project) {
      const homeId = projectHomeScreenId(project, history);
      const home =
        homeId === null ? null : (history.find((c) => c.id === homeId) ?? null);
      if (home) entry = home;
      else {
        unmatched = true;
        entry = null;
      }
    }
  }

  const spec = entry?.spec ?? published?.spec ?? liveProject?.spec ?? null;

  // Runtime classes: spec classNames exist only at runtime — compile any not
  // yet covered via /api/tailwind (same no-op-on-failure behavior as the
  // playground; the hook is session-cached so revisits cost nothing).
  // Bake coverage (plan 057-C / 069 task 5 decision 23): servingArtifact()
  // returns an artifact only when version-matched, and a local history entry
  // is always a fresh object — identity with the published page's spec OR the
  // matched live snapshot's spec (passed here by reference from the server)
  // means "rendering exactly what was baked", so the round-trip is
  // redundant. A spec rendered from elsewhere — an owner's local edit in
  // front of the page — keeps requesting: it may be newer than the bake and
  // its new classes still need compiling.
  useRuntimeClasses(spec, {
    precovered:
      Boolean(bakedCss) &&
      (spec === published?.spec || spec === liveProject?.spec),
  });

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
      // A live HANDLE page is public serving too — persist the visitor's
      // decision site-wide (same rule as the published projection).
      if (entry !== null || (!published && !liveProject)) return;
      if (!isTheme(params.theme)) return;
      persistThemeDecision(params.theme);
    };
  });

  // Pending gate: the server knows no history. A bare published slug (or a
  // server-resolved live handle, which already matched its path) can render
  // straight away; a PATH under an unknown namespace waits — only the client
  // can tell whether a local entry or project claims it, and a premature 404
  // here would set a real status the client can't undo.
  if (entry === undefined && !liveProject && (routePath || !published)) {
    return (
      <main className="dot-grid flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("uiRoute.loading")}</p>
      </main>
    );
  }

  if (unmatched || (entry === null && !published && !liveProject)) {
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
  // Deep-link in (052, D9 — preview surface, decision 11): declared urlSync
  // keys overlay the seed so the first paged read already runs at the linked
  // page. Client-only: window is absent during SSR (the seed renders there
  // and the overlay joins on hydration) — same guard as the canvas.
  // Path params (061-3) overlay LAST — the URL path wins over the query —
  // and unlike the window-guarded urlSync overlay they also apply during SSR.
  // Shared /session (061-4, A3): project screens seed WITHOUT `session` —
  // the provider's initialState diff deletes the key on every screen change
  // and <SessionSync> pulls the live store value back pre-paint. A
  // render-time store read could be applied late under Next 16's <Activity>
  // (plan 059), re-adding a stale session (the e2e-proven race); SSR renders
  // without session either way (same hydration behavior as the old
  // client-only merge). No project → the seed is untouched.
  const withSession = entry?.projectId ? omitSessionState(state) : state;
  const seedState = overlayPathState(
    typeof window === "undefined"
      ? withSession
      : overlayUrlState(withSession, window.location.search, specUrlSync(spec)),
    pathParams,
  );
  const localized = localizeSpec(spec, seedState);

  // The state-write fallback (decision 13): specs that predate the declared
  // switch still navigate by writing state.locale — but once the toggle
  // binds switch_language the action owns navigation and this would
  // double-push, so it stays off.
  const handleStateChange = (
    changes: Array<{ path: string; value: unknown }>,
  ) => {
    // Shareable deep links (052, D9 — preview surface, decision 11): mirror
    // the spec's declared urlSync keys into the browser URL in place
    // (replaceState — no history spam), whatever else the change batch
    // carries. Unconditional: replaceState can't double-fire anything.
    const urlSync = specUrlSync(spec);
    if (urlSync.length > 0 && typeof window !== "undefined") {
      const nextSearch = urlSearchAfterStateChange(
        window.location.search,
        changes,
        urlSync,
      );
      if (nextSearch !== null && nextSearch !== window.location.search) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${nextSearch}${window.location.hash}`,
        );
      }
    }
    if (hasSwitchLanguageBinding(spec)) return;
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
  const entryName = entry?.name ?? published?.name ?? liveProject?.handle;

  return (
    <JSONUIProvider
      registry={registry}
      initialState={seedState}
      onStateChange={handleStateChange}
      handlers={handlers}
      validationFunctions={{}}
      // Same computed-function set as the playground and live pages — without
      // it, `$computed` props (filterItems/sliceItems/stepPage/pageLabel)
      // render unresolved on this surface.
      functions={PLAYGROUND_FUNCTIONS}
      directives={appDirectives}
    >
      {/* Data sources runtime (docs/plan/043-data-sources, D6/D8): the
                  project id for project screens (061-4 — owner preview then
                  shares the project's records with the editor) and the slug
                  otherwise, which keeps D6's per-design isolation: owner
                  preview and published visitors share one per-browser store.
                  069: a live HANDLE page is a project screen with no local
                  entry — `entry ?? liveProject` keeps its namespace the
                  PROJECT id, which is the `app_id` partition the supabase
                  adapter filters on (a handle namespace would read empty). */}
      <QueryLoader
        spec={spec}
        namespace={dataNamespaceFor(entry ?? liveProject, slug)}
      />
      {/* Shared /session write-through (061-4): mirrors state.session into
          the project store, debounced and flushed on unmount. No project →
          no-op, so screen-local state never leaks across screens. */}
      {entry?.projectId && <SessionSync projectId={entry.projectId} />}
      {/* Screen navigation (061, decision 4 + 061-3): resolves the ref
                  against this device's screens in the entry's project scope
                  and pushes /{locale}/{project-slug}[/{route}]. A visitor's
                  browser holds no history, so an unknown ref there warns and
                  no-ops — never throws. Registered inside the provider so it
                  can deref $item path params against the live snapshot. */}
      <NavigateHandler
        surface="preview"
        entries={() => getHistory()}
        scope={() => screenScope(entry)}
        locale={locale}
        projects={getProjects()}
        navigate={(route) => router.push(route)}
      />
      {/* Bare surface: no background, chrome, or layout padding — the
                spec renders as-is; only the floating pill sits on top. */}
      <ThemeHtmlSync />
      <main className="relative w-full">
        {/* Pre-paint: the spec's dark default applies only when the visitor
                carries no stored decision (ThemeInit in the layout applies
                one) — rendered whenever a published page is being served, so
                it lands in the server HTML. */}
        {published || liveProject ? (
          <SpecThemeInit specDefault={specDefault} />
        ) : null}
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
