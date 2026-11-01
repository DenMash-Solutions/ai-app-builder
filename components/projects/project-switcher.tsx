"use client";

import { useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import { Check, Folder, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createProject,
  getActiveProjectId,
  getProjects,
  getServerActiveProjectId,
  getServerProjects,
  projectNameError,
  setActiveProjectId,
  subscribeActiveProject,
  subscribeProjects,
} from "@/lib/projects/projects";

interface ProjectSwitcherProps {
  /** Pill for the desktop header, row for the collapsed menu. */
  variant?: "pill" | "row";
  className?: string;
}

/**
 * Top-bar project switcher (plan 061 A1 / Q3): shows the project new screens
 * are created into and lists the rest for switching. Creation uses an inline
 * input; rename/delete live on the history drawer's group headers.
 */
export function ProjectSwitcher({
  variant = "pill",
  className,
}: ProjectSwitcherProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const projects = useSyncExternalStore(
    subscribeProjects,
    getProjects,
    getServerProjects,
  );
  const activeId = useSyncExternalStore(
    subscribeActiveProject,
    getActiveProjectId,
    getServerActiveProjectId,
  );
  const active = projects.find((project) => project.id === activeId) ?? null;
  const label = active?.name ?? t("projects.none");

  const handleCreate = (name: string): void => {
    // Reserved names toast the reason and keep the input open (064).
    if (projectNameError(name) !== null) {
      toast.error(t("projects.reserved"));
      return;
    }
    if (createProject(name) === null) return;
    setCreating(false);
    setOpen(false);
  };

  const handleCreateKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreate(event.currentTarget.value);
      return;
    }
    if (event.key === "Escape") {
      // Radix's dismiss layer already ran (capture-phase on document) — while
      // the inline input is open Escape must cancel it, not close the popover
      // (the content's onEscapeKeyDown below keeps the popover open).
      event.preventDefault();
      setCreating(false);
    }
  };

  const content = (
    <PopoverContent
      align="end"
      aria-label={t("projects.switch")}
      className="w-64 p-1"
      onEscapeKeyDown={(event) => {
        if (creating) event.preventDefault();
      }}
    >
      <div className="flex flex-col gap-0.5">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            aria-current={project.id === activeId ? "true" : undefined}
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
            onClick={() => {
              setActiveProjectId(project.id);
              setOpen(false);
            }}
          >
            <Folder
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.id === activeId && (
              <Check aria-hidden="true" className="size-4 shrink-0" />
            )}
          </button>
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("projects.noneYet")}
          </p>
        )}
      </div>
      <div className="mt-1 border-t pt-1">
        {creating ? (
          <input
            autoFocus
            aria-label={t("projects.createPlaceholder")}
            placeholder={t("projects.createPlaceholder")}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none"
            onKeyDown={handleCreateKeyDown}
          />
        ) : (
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" className="size-4 shrink-0" />
            {t("projects.create")}
          </button>
        )}
      </div>
    </PopoverContent>
  );

  if (variant === "row") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-9 w-full justify-start gap-2 rounded-md px-2",
              className,
            )}
          >
            <Folder aria-hidden="true" className="size-4 shrink-0" />
            <span>{t("projects.label")}</span>
            <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
              {label}
            </span>
          </Button>
        </PopoverTrigger>
        {content}
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("projects.switch")}
          className={cn("h-7 gap-1.5 px-2 text-xs", className)}
        >
          <Folder aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="max-w-28 truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      {content}
    </Popover>
  );
}
