"use client";

import type { Theme } from "@/lib/theme";
import { specThemeInitScript } from "@/lib/theme/spec-theme";

/**
 * Public-surface sibling of ThemeInit (docs/plan/042-tool-rail-and-spec-theme):
 * applies the SPEC's default theme pre-paint — but only when the visitor has
 * no stored decision (ThemeInit, rendered earlier in the layout, already
 * applies one). Runs while the parser reads it (server-rendered
 * `text/javascript`), so a dark-by-default design never flashes light.
 * Renders nothing when the spec carries no dark default.
 */
export function SpecThemeInit({ specDefault }: { specDefault: Theme | null }) {
  const script = specThemeInitScript(specDefault);
  if (script === "") return null;
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
