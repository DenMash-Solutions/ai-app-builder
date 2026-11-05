"use client";

import type { Spec } from "@json-render/core";
import { collectSpecClassTokens } from "@/lib/runtime-classes/candidates";
import { bakeHtmlByLanguage, classifySpec } from "@/lib/publish/bake";
import type { BakedArtifact } from "@/lib/publish/artifacts";
import { routePatternParams } from "@/lib/projects/screen-routes";

/**
 * Publish-time bake — orchestration (plan 055-C / 069 task 5). Runs client
 * React: the spec's class tokens compile server-side (`/api/tailwind`),
 * static HTML renders per language, and the assembled per-tag artifacts
 * persist via `/api/publish-artifacts`.
 *
 * Entirely best-effort: any failure (CSS compile, render, persist) is
 * swallowed — the publish already succeeded and serving degrades to client
 * rendering until a bake lands (decisions 21/22, plan 069).
 */

/** One entry point the project bake accepts off `publishProject`'s result. */
export interface BakeEntryPoint {
  route: string;
  spec: Spec;
  version: number;
}

/**
 * A route with `{param}` segments can never be baked ahead of time
 * (plan 069 decision 3) — it always client-renders with state seeded from
 * the path. Static = the home rung (`''`) plus literal patterns.
 */
export function isStaticRoute(route: string): boolean {
  return routePatternParams(route).length === 0;
}

/**
 * CSS + per-tag static HTML for one spec, or null when the compile fails —
 * the shared core of the screen bake and the per-route project bake
 * (decision 22: one `/api/tailwind` call per entry point).
 */
async function bakeSpecArtifacts(
  spec: Spec,
  version: number,
): Promise<Record<string, BakedArtifact> | null> {
  const cssResponse = await fetch("/api/tailwind", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates: collectSpecClassTokens(spec) }),
  });
  if (!cssResponse.ok) return null;
  const { css } = (await cssResponse.json()) as { css?: unknown };
  if (typeof css !== "string") return null;

  const kind = classifySpec(spec);
  const html = bakeHtmlByLanguage(spec);
  return Object.fromEntries(
    Object.entries(html).map(([tag, markup]) => [
      tag,
      { html: markup, css, kind, version } satisfies BakedArtifact,
    ]),
  );
}

export async function bakeAndPersistArtifacts(
  uiId: string,
  spec: Spec,
  version: number,
): Promise<void> {
  try {
    const artifacts = await bakeSpecArtifacts(spec, version);
    if (artifacts === null) return;

    await fetch("/api/publish-artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiId, version, artifacts }),
    });
  } catch {
    // Best-effort bake — a failure never surfaces; serving falls back.
  }
}

/**
 * The project variant (plan 069 task 5, decision 21): the publish dialog
 * fires this `void …` after `publishProject` succeeds. Only STATIC routes
 * bake (decision 3 — `isStaticRoute` filters); each bakes and persists
 * sequentially (decision 22), and one route's failure never skips the rest,
 * so the artifacts column stays consistent with every version that landed.
 */
export async function bakeProjectEntryPoints(
  projectId: string,
  rows: readonly BakeEntryPoint[],
): Promise<void> {
  for (const row of rows) {
    if (!isStaticRoute(row.route)) continue;
    try {
      const artifacts = await bakeSpecArtifacts(row.spec, row.version);
      if (artifacts === null) continue;

      await fetch("/api/publish-artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          route: row.route,
          version: row.version,
          artifacts,
        }),
      });
    } catch {
      // Best-effort per route — serving falls back to client rendering.
    }
  }
}
