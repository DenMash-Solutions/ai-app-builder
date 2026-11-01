/**
 * Membership-driven drawer grouping (plan 065, task 4): which screens sit
 * under which project header in the history drawer, and in what order.
 *
 * Membership ROWS are the source of truth (decision 1) — `entry.projectId`
 * is only the device-local "born into" hint. A screen appears in a project
 * iff a row pairs them (so a screen in two projects shows in both), ordered
 * by the row's position. An entry no listed project claims — no row, or
 * only rows of projects that no longer exist — falls into the trailing
 * legacy bucket. Dangling rows (screen deleted) claim nothing; screenless
 * projects still get their (empty) group so a fresh project is visible.
 *
 * Pure functions only (dependency-injected) — the drawer subscribes to the
 * stores and passes rows in.
 */
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";

/** One project's group of screens — `project: null` is the legacy bucket. */
export interface ProjectGroup {
  project: Project | null;
  entries: HistoryEntry[];
}

/** Same tie-break the store sorts membership rows by (decision 6). */
function compareRows(a: ProjectMembership, b: ProjectMembership): number {
  return (
    a.position - b.position ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

export function groupEntriesForDrawer(
  entries: readonly HistoryEntry[],
  projects: readonly Project[],
  memberships: readonly ProjectMembership[],
): ProjectGroup[] {
  const buckets: ProjectGroup[] = projects.map((project) => ({
    project,
    entries: [],
  }));
  const byId = new Map(
    projects.map((project, index) => [project.id, buckets[index]]),
  );
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  // Claimed pairs grouped per project — one push per pair even if a corrupt
  // store ever held duplicates (sanitize dedupes; belt and braces).
  const pairsByProject = new Map<
    string,
    Array<{ entry: HistoryEntry; row: ProjectMembership }>
  >();
  const claimedEntries = new Set<string>();
  for (const row of memberships) {
    if (!byId.has(row.projectId)) continue; // unknown/dangling project
    const entry = entryById.get(row.screenId);
    if (!entry) continue; // dangling row claims nothing
    let pairs = pairsByProject.get(row.projectId);
    if (!pairs) {
      pairs = [];
      pairsByProject.set(row.projectId, pairs);
    }
    if (pairs.some((pair) => pair.entry.id === entry.id)) continue;
    claimedEntries.add(entry.id);
    pairs.push({ entry, row });
  }

  for (const [projectId, pairs] of pairsByProject) {
    const bucket = byId.get(projectId);
    if (!bucket) continue;
    pairs.sort((a, b) => compareRows(a.row, b.row));
    bucket.entries = pairs.map((pair) => pair.entry);
  }

  const legacy = entries.filter((entry) => !claimedEntries.has(entry.id));
  return legacy.length > 0
    ? [...buckets, { project: null, entries: legacy }]
    : buckets;
}
