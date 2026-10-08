import { compile } from "@tailwindcss/node";
import path from "node:path";
import { findMissingTokens } from "./escape";

/**
 * Server-side on-demand Tailwind compile. The input mirrors the project's
 * static build theme (app/theme-tokens.css — shared with app/globals.css) so
 * semantic tokens (bg-card, dark:) resolve identically; @source scans are
 * omitted because candidates are supplied explicitly by the request.
 *
 * Utilities are routed into the `components` layer, NOT `utilities`: the
 * static build declares `@layer theme, base, components, utilities`, and
 * injected rules must lose every class-name collision with the chrome (e.g.
 * a spec's `.flex-col` vs the app's `.sm:flex-row` on <main>). `components`
 * is established by the static stylesheet, so cascade position is fixed no
 * matter when the runtime tag is appended; non-conflicting injected rules
 * still apply. Joining `utilities` instead would append AFTER the static
 * utilities and win equal-specificity conflicts — the drawer-blanking bug.
 */
const compileInput = (): string =>
  [
    `@import "${path.join(process.cwd(), "node_modules/tailwindcss/theme.css")}" reference;`,
    `@import "${path.join(process.cwd(), "app/theme-tokens.css")}";`,
    `@import "${path.join(process.cwd(), "node_modules/tailwindcss/utilities.css")}" layer(components);`,
  ].join("\n");

type BuildFn = (candidates: string[]) => string;

let buildPromise: Promise<BuildFn> | null = null;

/** Compile once per process; concurrent first requests share the promise. */
function getBuild(): Promise<BuildFn> {
  buildPromise ??= compile(compileInput(), {
    base: process.cwd(),
    onDependency: () => {},
  }).then((result) => result.build);
  return buildPromise;
}

export interface CandidateBuildResult {
  /** CSS for every candidate that produced a rule (may be ""). */
  css: string;
  /** Requested tokens with no emitted rule (invalid utility names). */
  missing: string[];
}

/** Compiles candidates and reports which ones produced no CSS rule. */
export async function buildForCandidates(
  candidates: string[],
): Promise<CandidateBuildResult> {
  const build = await getBuild();
  const css = build(candidates);
  const missing = findMissingTokens(css, candidates);
  return { css, missing };
}
