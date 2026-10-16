"use client";

import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { ArrowUpRight } from "lucide-react";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { Button } from "@/components/ui/button";
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
import { appDirectives } from "@/lib/computed/directives";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import { localizeSpec } from "@/lib/specs/localize";

/**
 * Chrome-less render of the featured spec (root): no playground chrome —
 * only the floating "Open playground" pill. Runtime classNames are compiled
 * on demand via /api/tailwind, exactly like the local preview route.
 *
 * The route locale is the content language: its `i18n` overlay merges over
 * the seed copy before the state store seeds, and `state.locale` is injected
 * from the route so the switcher's highlight shows the language this page
 * actually serves (decisions 11/12). Switching is the declared
 * `switch_language` action (decision 13): the root serves every language
 * the design carries, so it pushes `/{tag}` — with the state-write
 * intercept kept as the fallback for specs that predate the binding.
 *
 * `bakedCss` (optional) is the publish-baked stylesheet for the spec's class
 * tokens — server-injected so a `stateful` page paints styled before the
 * runtime compile kicks in (no FOUC).
 */
export function LivePage({
  spec,
  bakedCss,
}: {
  spec: Spec;
  bakedCss?: string | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const state = useMemo(() => {
    const merged = mergeI18n(spec.state, locale) ?? {};
    return SPEC_STATE_KEYS.locale in merged
      ? { ...merged, [SPEC_STATE_KEYS.locale]: locale }
      : merged;
  }, [spec, locale]);
  const localized = useMemo(() => localizeSpec(spec, state), [spec, state]);
  useRuntimeClasses(spec);

  // Decision 13: the toggle's change event hands the pressed tag here.
  // The handler stays stable-once (ActionProvider captures its initial
  // handlers) while an effect re-syncs the closure each render — a stale
  // one would guard with the previous route's locale after a switch.
  const switchRef = useRef<(params: Record<string, unknown>) => void>(() => {});
  useEffect(() => {
    switchRef.current = (params) => {
      const tag = params.tag;
      if (typeof tag !== "string" || tag === locale) return;
      if (!availableLanguages(spec).includes(tag)) return;
      router.push(`/${tag}`);
    };
  });
  const handlers = useMemo(
    () => ({
      [SWITCH_LANGUAGE_ACTION]: (params: Record<string, unknown>) =>
        switchRef.current(params),
    }),
    [],
  );

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
    router.push(`/${tag}`);
  };

  // The preview pill points at the playground in an app language: on a
  // content-only root the unprefixed link would be prefixed into /{tag}/ui,
  // a 404 (decision 11's pinning rule, applied to the root in decision 12).
  const pillLocale = hasLocale(LOCALES, locale)
    ? locale
    : routing.defaultLocale;

  return (
    <JSONUIProvider
      registry={registry}
      initialState={state}
      onStateChange={
        hasSwitchLanguageBinding(spec) ? undefined : handleStateChange
      }
      handlers={handlers}
      validationFunctions={{}}
      functions={PLAYGROUND_FUNCTIONS}
      directives={appDirectives}
    >
      <main className="relative w-full">
        {bakedCss ? <style>{bakedCss}</style> : null}
        <Renderer spec={fixupScrollLayout(localized)} registry={registry} />
        <Button asChild className="fixed bottom-4 right-4 z-50 shadow-lg">
          <Link href="/ui" locale={pillLocale}>
            <ArrowUpRight aria-hidden="true" className="size-4" />
            {t("preview.openPlayground")}
          </Link>
        </Button>
      </main>
    </JSONUIProvider>
  );
}
