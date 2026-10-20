"use client";

import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasDataBlocks } from "@/lib/data-sources/types";
import { availableLanguages, mergeI18n } from "@/lib/i18n/spec-languages";
import { localizeSpec } from "@/lib/specs/localize";
import { registry } from "@/lib/playground/registry";
import { appDirectives } from "@/lib/computed/directives";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import type { SpecKind } from "@/lib/publish/artifacts";

/**
 * Publish-time bake — HTML half (plan §5). The spec tree is rendered to static
 * markup so a `content` page can be served with no client components. The
 * render runs in the browser (the go-live dialog, which already has the spec
 * and the client React runtime): Next's RSC route layer treats the json-render
 * providers + shadcn registry as opaque client references, so
 * `renderToStaticMarkup` of them cannot run server-side. The compiled-CSS half
 * stays server-side (via `/api/tailwind`) and the assembled artifacts are
 * persisted by a thin server route (`/api/publish-artifacts`).
 */

/**
 * A spec is `stateful` when any element reacts to state/interaction (`on`,
 * `watch`) or binds a prop to the store (`$bindState`/`$bindItem`) — such a
 * page needs the client engine, so it renders client-side with the baked CSS
 * rather than as pure static markup.
 */
export function classifySpec(spec: Spec): SpecKind {
  // Data sources (docs/plan/043-data-sources, D4): a spec that declares
  // queries/dataSources renders against the `/queries` runtime mirror —
  // it needs the client engine, so it never bakes as static markup even
  // when no element binds state directly.
  if (hasDataBlocks(spec)) return "stateful";
  const elements = Object.values(spec.elements ?? {});
  for (const element of elements) {
    if (element.on && Object.keys(element.on).length > 0) return "stateful";
    if (element.watch && Object.keys(element.watch).length > 0)
      return "stateful";
  }
  const props = JSON.stringify(elements.map((element) => element.props ?? {}));
  return props.includes("$bindState") || props.includes("$bindItem")
    ? "stateful"
    : "content";
}

/** The spec tree for one merged language — mirrors `LivePage`'s inner render. */
export function renderSpecHtml(
  spec: Spec,
  mergedState: Record<string, unknown>,
): string {
  const localized = localizeSpec(spec, mergedState);
  const tree = fixupScrollLayout(localized);
  return renderToStaticMarkup(
    <JSONUIProvider
      registry={registry}
      initialState={mergedState}
      handlers={{}}
      validationFunctions={{}}
      directives={appDirectives}
    >
      <Renderer spec={tree} registry={registry} />
    </JSONUIProvider>,
  );
}

/** Static HTML per language a spec carries, keyed by canonical tag. */
export function bakeHtmlByLanguage(spec: Spec): Record<string, string> {
  const html: Record<string, string> = {};
  for (const tag of availableLanguages(spec)) {
    html[tag] = renderSpecHtml(
      spec,
      (mergeI18n(spec.state, tag) ?? {}) as Record<string, unknown>,
    );
  }
  return html;
}
