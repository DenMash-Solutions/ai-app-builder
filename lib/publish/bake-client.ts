"use client";

import type { Spec } from "@json-render/core";
import { collectSpecClassTokens } from "@/lib/runtime-classes/candidates";
import { bakeHtmlByLanguage, classifySpec } from "@/lib/publish/bake";
import type { BakedArtifact } from "@/lib/publish/artifacts";

/**
 * Publish-time bake — orchestration half (plan §5). Runs in the go-live
 * dialog after `publishEntry`: compiles the spec's class tokens server-side
 * (`/api/tailwind`), renders static HTML per language (client React — see
 * `bake.tsx`), and persists the assembled artifacts via `/api/publish-artifacts`.
 *
 * Entirely best-effort: any failure (CSS compile, render, persist) is
 * swallowed — the publish already succeeded and serving degrades to client
 * rendering until a bake lands.
 */
export async function bakeAndPersistArtifacts(
  uiId: string,
  spec: Spec,
  version: number,
): Promise<void> {
  try {
    const cssResponse = await fetch("/api/tailwind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: collectSpecClassTokens(spec) }),
    });
    if (!cssResponse.ok) return;
    const { css } = (await cssResponse.json()) as { css?: unknown };
    if (typeof css !== "string") return;

    const kind = classifySpec(spec);
    const html = bakeHtmlByLanguage(spec);
    const artifacts = Object.fromEntries(
      Object.entries(html).map(([tag, markup]) => [
        tag,
        { html: markup, css, kind, version } satisfies BakedArtifact,
      ]),
    );

    await fetch("/api/publish-artifacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiId, version, artifacts }),
    });
  } catch {
    // Best-effort bake — a failure never surfaces; serving falls back.
  }
}
