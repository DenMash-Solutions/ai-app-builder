"use client";

import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { mergeI18n } from "@/lib/i18n/spec-languages";
import { registry } from "@/lib/playground/registry";
import { appDirectives } from "@/lib/computed/directives";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import { localizeSpec } from "@/lib/specs/localize";

/**
 * Chrome-less render of a published spec (featured root, live URL): no
 * playground chrome — only the floating "Open playground" pill. Runtime
 * classNames are compiled on demand via /api/tailwind, exactly like the
 * local preview route.
 *
 * The route locale is the content language: its `i18n` overlay merges over
 * the seed copy before the state store seeds, while `state.locale` keeps
 * following app routing ($template hrefs).
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
  const state = useMemo(
    () => mergeI18n(spec.state, locale) ?? {},
    [spec, locale],
  );
  const localized = useMemo(() => localizeSpec(spec, state), [spec, state]);
  useRuntimeClasses(spec);

  return (
    <JSONUIProvider
      registry={registry}
      initialState={state}
      handlers={{}}
      validationFunctions={{}}
      directives={appDirectives}
    >
      <main className="relative w-full">
        {bakedCss ? <style>{bakedCss}</style> : null}
        <Renderer spec={fixupScrollLayout(localized)} registry={registry} />
        <Button asChild className="fixed bottom-4 right-4 z-50 shadow-lg">
          <Link href="/ui">
            <ArrowUpRight aria-hidden="true" className="size-4" />
            {t("preview.openPlayground")}
          </Link>
        </Button>
      </main>
    </JSONUIProvider>
  );
}
