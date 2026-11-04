import type { Spec } from "@json-render/core";
import { validateDataSources } from "@/lib/data-sources/validate";
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";
import { projectHomeScreenId } from "@/lib/projects/screen-routes";
import type { ProjectEntryPoint } from "@/lib/publish/project-publish";

/**
 * Publish validation (plan 069 task 4, decision 20): one pass over the
 * project BEFORE any write, calling the existing checkers (F9 — no second
 * validator). Any issue refuses the publish fail-closed, so a site never
 * goes live with a namespace that 404s its own front page.
 */
export const PROJECT_PUBLISH_ISSUES = {
  /** No `homeScreenId` (or it dangles) — the bare handle URL would 404. */
  noHome: "noHome",
  /** A membership points at a screen that no longer exists. */
  missingScreen: "missingScreen",
  /** A configured `{param}` route pattern is malformed. */
  invalidRoute: "invalidRoute",
  /** A snapshot spec's data config cannot run for visitors (067 gate). */
  dataConfig: "dataConfig",
} as const;

export type ProjectPublishIssue =
  (typeof PROJECT_PUBLISH_ISSUES)[keyof typeof PROJECT_PUBLISH_ISSUES];

export interface ProjectPublishValidation {
  ok: boolean;
  /** Present only when `ok` is false — the FIRST blocking issue. */
  issue?: ProjectPublishIssue;
  /** Diagnostic detail (offending route/screen, first data-source message). */
  detail?: string;
}

/**
 * A well-formed route pattern: every `{...}` token is stripped cleanly and
 * carries a non-empty name. `items/{id}` ✓ · `items/{id` ✗ (stray brace) ·
 * `{}` ✗ (anonymous placeholder) · `a{{b}` ✗ (nested brace). A malformed
 * pattern can never match, so it would silently drop a screen's rung.
 */
export function isWellFormedRoutePattern(pattern: string): boolean {
  const tokens = [...pattern.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const stripped = pattern.replace(/\{[^{}]*\}/g, "");
  if (/[{}]/.test(stripped)) return false;
  return tokens.every((name) => name.trim() !== "");
}

/**
 * The three hard-block checks of decision 20, in order:
 *
 *  1. home set — `projectHomeScreenId` validates the explicit id against
 *     the membership (a dangling id reads as no home, same as the resolver),
 *  2. every membership resolves: its screen still exists and its configured
 *     route pattern is well-formed (the snapshot builder skips dangling
 *     screens silently — publish must not),
 *  3. every snapshot row's data configs pass `validateDataSources` with the
 *     067 in-project capability gate (visitor credentials rule).
 *
 * Pure: rows injected, no stores, no network — `publishProject` runs it
 * before the first statement.
 */
export function validateProjectPublish(
  project: Project,
  entries: readonly HistoryEntry[],
  memberships: readonly ProjectMembership[],
  entryPoints: readonly ProjectEntryPoint[],
): ProjectPublishValidation {
  if (projectHomeScreenId(project, entries, memberships) === null) {
    return { ok: false, issue: PROJECT_PUBLISH_ISSUES.noHome };
  }

  for (const row of memberships) {
    if (row.projectId !== project.id) continue;
    if (!entries.some((entry) => entry.id === row.screenId)) {
      return {
        ok: false,
        issue: PROJECT_PUBLISH_ISSUES.missingScreen,
        detail: row.screenId,
      };
    }
    if (row.route !== null && !isWellFormedRoutePattern(row.route)) {
      return {
        ok: false,
        issue: PROJECT_PUBLISH_ISSUES.invalidRoute,
        detail: row.route,
      };
    }
  }

  for (const row of entryPoints) {
    const issues = validateDataSources(row.spec as Spec, { inProject: true });
    if (issues.length > 0) {
      return {
        ok: false,
        issue: PROJECT_PUBLISH_ISSUES.dataConfig,
        detail: `${row.route}: ${issues[0].message}`,
      };
    }
  }

  return { ok: true };
}
