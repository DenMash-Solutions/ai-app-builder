"use client";

import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
} from "@json-render/react";
import type { Spec } from "@json-render/core";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";

/**
 * Chrome-less render of a published spec (featured root, live URL): no
 * playground chrome — only the floating "Open playground" pill. Runtime
 * classNames are compiled on demand via /api/tailwind, exactly like the
 * local preview route.
 */
export function LivePage({ spec }: { spec: Spec }) {
  const t = useTranslations();
  useRuntimeClasses(spec);

  return (
    <StateProvider initialState={spec.state ?? {}}>
      <VisibilityProvider>
        <ActionProvider handlers={{}}>
          <ValidationProvider customFunctions={{}}>
            <main className="relative w-full">
              <Renderer spec={fixupScrollLayout(spec)} registry={registry} />
              <Button asChild className="fixed bottom-4 right-4 z-50 shadow-lg">
                <Link href="/ui">
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
