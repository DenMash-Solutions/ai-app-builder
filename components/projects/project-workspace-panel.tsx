"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HistoryEntry } from "@/lib/history";
import {
  addScreenToProject,
  copyScreenToProject,
  getMemberships,
  getServerMemberships,
  moveScreenBetweenProjects,
  removeScreenFromProject,
  reorderProjectMembers,
  setMembershipRoute,
  subscribeMemberships,
} from "@/lib/projects/memberships";
import type { ProjectMembership } from "@/lib/projects/memberships";
import {
  getProjects,
  getServerProjects,
  setProjectHomeScreenId,
  subscribeProjects,
} from "@/lib/projects/projects";

interface ProjectWorkspacePanelProps {
  projectId: string;
  /** Every screen on this device — resolves names and feeds the add picker. */
  entries: readonly HistoryEntry[];
  /**
   * Reports inline-edit state upward so the drawer's Escape veto can cover
   * it (radix-escape-capture: the dismiss layer runs before the input's own
   * keydown handler — cancelling from the input alone closes the drawer).
   */
  onEditingChange: (editing: boolean) => void;
}

/** Same row tie-break the store and the drawer grouping use (decision 6). */
function compareRows(a: ProjectMembership, b: ProjectMembership): number {
  return (
    a.position - b.position ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

/**
 * The expandable workspace section inside a drawer project group (plan 065,
 * decision 14): the project's membership rows with the management
 * affordances — home pick (decision 5), route config (decision 6/7),
 * reorder, move/copy between projects, remove — plus an "add screen" picker
 * over the screens that are not members yet. All writes go through the
 * membership/projects stores; this component holds no state of its own
 * beyond the inline route draft.
 */
export function ProjectWorkspacePanel({
  projectId,
  entries,
  onEditingChange,
}: ProjectWorkspacePanelProps) {
  const t = useTranslations();
  const memberships = useSyncExternalStore(
    subscribeMemberships,
    getMemberships,
    getServerMemberships,
  );
  const projects = useSyncExternalStore(
    subscribeProjects,
    getProjects,
    getServerProjects,
  );

  const project = projects.find((candidate) => candidate.id === projectId);
  const members = useMemo(
    () =>
      memberships
        .filter((row) => row.projectId === projectId)
        .map((row) => ({
          row,
          entry: entries.find((e) => e.id === row.screenId),
        }))
        .filter(
          (member): member is { row: ProjectMembership; entry: HistoryEntry } =>
            member.entry !== undefined,
        )
        .sort((a, b) => compareRows(a.row, b.row)),
    [memberships, entries, projectId],
  );

  const [editingScreenId, setEditingScreenId] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState("");

  useEffect(() => {
    onEditingChange(editingScreenId !== null);
  }, [editingScreenId, onEditingChange]);
  // Collapse/unmount while editing must never strand the drawer's veto.
  useEffect(() => () => onEditingChange(false), [onEditingChange]);

  const memberIds = new Set(members.map((member) => member.entry.id));
  const candidates = entries.filter((entry) => !memberIds.has(entry.id));
  const others = projects.filter((candidate) => candidate.id !== projectId);
  const homeId = project?.homeScreenId ?? null;

  const toggleHome = (screenId: string): void => {
    // Toggling the current home off leaves the root entry point empty —
    // a legal state (decision 5), healed by the next fill or explicit pick.
    setProjectHomeScreenId(projectId, homeId === screenId ? null : screenId);
  };

  const startRouteEdit = (screenId: string, current: string | null): void => {
    setRouteDraft(current ?? "");
    setEditingScreenId(screenId);
  };

  const commitRoute = (): void => {
    if (editingScreenId === null) return;
    const value = routeDraft.trim();
    const next = value === "" ? null : value;
    const current =
      members.find((member) => member.entry.id === editingScreenId)?.row
        .route ?? null;
    if (next !== current) {
      // `false` here can only mean a route collision in practice (the pair
      // is a member and the value changed) — decision 7 rejects at write.
      if (!setMembershipRoute(projectId, editingScreenId, next)) {
        toast.error(t("projects.routeTaken"));
        return;
      }
    }
    setEditingScreenId(null);
  };

  const handleRouteKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRoute();
      return;
    }
    if (event.key === "Escape") {
      // The drawer's Escape veto (via onEditingChange) keeps the drawer
      // open; this cancels the edit itself.
      event.preventDefault();
      setEditingScreenId(null);
    }
  };

  const reorder = (index: number, delta: number): void => {
    const ids = members.map((member) => member.entry.id);
    const swap = index + delta;
    if (swap < 0 || swap >= ids.length) return;
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    reorderProjectMembers(projectId, ids);
  };

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border bg-background/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">
          {t("projects.workspace")}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
            >
              <Plus aria-hidden="true" className="size-3" />
              {t("projects.addScreen")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
            {candidates.length === 0 ? (
              <DropdownMenuItem disabled>
                {t("projects.noCandidates")}
              </DropdownMenuItem>
            ) : (
              candidates.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onSelect={() => {
                    addScreenToProject(projectId, entry.id);
                  }}
                >
                  <span className="truncate">{entry.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {members.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("projects.emptyMembers")}
        </p>
      ) : (
        <>
          {homeId === null && (
            <p className="text-xs text-muted-foreground">
              {t("projects.noHome")}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {members.map(({ row, entry }, index) => {
              const isHome = homeId === entry.id;
              return (
                <li
                  key={row.id}
                  className="group flex items-center gap-1 rounded-md border px-1.5 py-1"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={
                      isHome ? t("projects.unsetHome") : t("projects.setHome")
                    }
                    aria-pressed={isHome}
                    className="h-6 px-1"
                    onClick={() => toggleHome(entry.id)}
                  >
                    <Star
                      aria-hidden="true"
                      className={`size-3.5 ${
                        isHome
                          ? "fill-amber-500 text-amber-500"
                          : "text-muted-foreground"
                      }`}
                    />
                  </Button>

                  <div className="min-w-0 flex-1">
                    {editingScreenId === entry.id ? (
                      <input
                        autoFocus
                        aria-label={t("projects.routeEdit")}
                        placeholder={t("projects.routePlaceholder")}
                        value={routeDraft}
                        onChange={(event) => setRouteDraft(event.target.value)}
                        onKeyDown={handleRouteKeyDown}
                        // Blur discards — Enter is the only commit path, so a
                        // stale blur after Escape can't re-apply a draft.
                        onBlur={() => setEditingScreenId(null)}
                        className="h-6 w-full rounded-md border bg-background px-1.5 text-xs outline-none"
                      />
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {entry.name}
                        </span>
                        {row.route !== null && (
                          <code className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            {row.route}
                          </code>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t("projects.routeEdit")}
                          className="h-5 px-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => startRouteEdit(entry.id, row.route)}
                        >
                          <Pencil aria-hidden="true" className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("projects.moveUp")}
                    disabled={index === 0}
                    className="h-6 px-1 text-muted-foreground"
                    onClick={() => reorder(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("projects.moveDown")}
                    disabled={index === members.length - 1}
                    className="h-6 px-1 text-muted-foreground"
                    onClick={() => reorder(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" className="size-3" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t("projects.rowActions", {
                          name: entry.name,
                        })}
                        className="h-6 px-1 text-muted-foreground"
                      >
                        <MoreHorizontal
                          aria-hidden="true"
                          className="size-3.5"
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={others.length === 0}>
                          {t("projects.moveTo")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {others.length === 0 ? (
                            <DropdownMenuItem disabled>
                              {t("projects.noOtherProjects")}
                            </DropdownMenuItem>
                          ) : (
                            others.map((target) => (
                              <DropdownMenuItem
                                key={target.id}
                                onSelect={() => {
                                  moveScreenBetweenProjects(
                                    projectId,
                                    target.id,
                                    entry.id,
                                  );
                                }}
                              >
                                <span className="truncate">{target.name}</span>
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={others.length === 0}>
                          {t("projects.copyTo")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {others.length === 0 ? (
                            <DropdownMenuItem disabled>
                              {t("projects.noOtherProjects")}
                            </DropdownMenuItem>
                          ) : (
                            others.map((target) => (
                              <DropdownMenuItem
                                key={target.id}
                                onSelect={() => {
                                  if (
                                    copyScreenToProject(
                                      projectId,
                                      target.id,
                                      entry.id,
                                    )
                                  ) {
                                    toast.success(
                                      t("projects.copied", {
                                        name: target.name,
                                      }),
                                    );
                                  }
                                }}
                              >
                                <span className="truncate">{target.name}</span>
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => {
                          removeScreenFromProject(projectId, entry.id);
                        }}
                      >
                        {t("projects.removeScreen")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
