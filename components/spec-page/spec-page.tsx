"use client";

import { useMemo } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { useLocale, useTranslations } from "next-intl";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { addEntry, createEntry } from "@/lib/history";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { QueryLoader } from "@/components/data-sources/query-loader";
import { localizeSpec } from "@/lib/specs/localize";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";
import { registry } from "@/lib/playground/registry";
import { appDirectives } from "@/lib/computed/directives";

/** Data-source scope of app-chrome specs (docs/plan/043-data-sources, D6). */
const SPEC_PAGE_DATA_NAMESPACE = "app";

/**
 * Imports the page's committed spec into the local playground as an editable
 * entry and opens it — the spec-mandate escape hatch that makes every spec
 * page tweakable without leaving the running app (edits stay local; saving
 * back to the repo is out of scope).
 */
export function EditInPlaygroundPill({ spec }: { spec: Spec }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const handleImport = () => {
    const entry = createEntry(t("specPage.editSourceLabel"), spec);
    addEntry(entry);
    router.push(`/${locale}/ui/${entry.id}`);
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={handleImport}
      className="fixed bottom-4 right-4 z-50 shadow-lg"
    >
      <PenLine aria-hidden="true" className="size-4" />
      {t("specPage.editInPlayground")}
    </Button>
  );
}

/**
 * Shared chrome for committed spec pages (login, signup, admin): providers +
 * renderer. Copy lives in state (`/copy/*`, `/checks/*`) so one spec serves
 * both locales — routes inject translated strings and the locale via
 * `extraState`. The "Edit in playground" affordance is NOT rendered here:
 * editing committed pages is an admin capability, surfaced from the admin
 * page (see `EditInPlaygroundPill`).
 */
export function SpecPage({
  spec,
  extraState,
  children,
  main = true,
}: {
  spec: Spec;
  extraState?: Record<string, unknown>;
  children?: React.ReactNode;
  /** Renders the page root as `<main>`; disable when a layout above already
   *  provides the landmark (e.g. the app shell's `SidebarInset`). */
  main?: boolean;
}) {
  // Checks carry { $state } messages the engine doesn't deep-resolve; the
  // localized spec swaps them for the injected copy.
  const initialState = useMemo(
    () => ({ ...(spec.state ?? {}), ...extraState }),
    [spec, extraState],
  );
  const localized = useMemo(
    () => localizeSpec(spec, initialState),
    [spec, initialState],
  );
  // Spec classNames exist only at runtime — compile uncovered ones (same
  // session-cached no-op-on-failure path as the playground and previews).
  useRuntimeClasses(localized);

  return (
    <JSONUIProvider
      registry={registry}
      initialState={initialState}
      handlers={{}}
      validationFunctions={{}}
      functions={PLAYGROUND_FUNCTIONS}
      directives={appDirectives}
    >
      {/* Data sources runtime (docs/plan/043-data-sources, D8): app-chrome
                  specs carry no data blocks today — this is a no-op until one
                  does. */}
      <QueryLoader spec={spec} namespace={SPEC_PAGE_DATA_NAMESPACE} />
      {main ? (
        <main className="relative w-full">
          <Renderer spec={localized} registry={registry} />
        </main>
      ) : (
        <div className="relative w-full">
          <Renderer spec={localized} registry={registry} />
        </div>
      )}
      {children}
    </JSONUIProvider>
  );
}
