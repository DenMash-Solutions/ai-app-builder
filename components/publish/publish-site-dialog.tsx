"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import {
  SLUG_STATUS_CLASS,
  SLUG_STATUS_TEXT,
  slugStatus,
} from "@/components/publish/slug-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";
import { isValidSlug } from "@/lib/slug";
import { ROUTE_CLAIM_KINDS, isReservedRoute } from "@/lib/routes/registry";
import { bakeProjectEntryPoints } from "@/lib/publish/bake-client";
import { createClient } from "@/lib/supabase/client";
import { asPublishClient, isSlugAvailable } from "@/lib/publish/publish";
import {
  PROJECT_PUBLISH_STATUS,
  getProjectPublishState,
  publishProject,
  unpublishProject,
} from "@/lib/publish/project-publish";
import type { ProjectPublishState } from "@/lib/publish/project-publish";
import { PROJECT_PUBLISH_ISSUES } from "@/lib/publish/validate-project";
import type { ProjectPublishIssue } from "@/lib/publish/validate-project";

/** Validation refusal → its copy (decision 20), object-constant keys. */
const ISSUE_MESSAGE_KEY: Record<ProjectPublishIssue, string> = {
  [PROJECT_PUBLISH_ISSUES.noHome]: "publish.siteIssueNoHome",
  [PROJECT_PUBLISH_ISSUES.missingScreen]: "publish.siteIssueMissingScreen",
  [PROJECT_PUBLISH_ISSUES.invalidRoute]: "publish.siteIssueInvalidRoute",
  [PROJECT_PUBLISH_ISSUES.dataConfig]: "publish.siteIssueDataConfig",
};

interface PublishSiteDialogProps {
  project: Project;
  entries: readonly HistoryEntry[];
  memberships: readonly ProjectMembership[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The state just written — the drawer badge updates from it, no refetch. */
  onStateChanged: (state: ProjectPublishState) => void;
}

/**
 * Project publish dialog (plan 069, task 3): claim the global handle,
 * snapshot every entry point and flip `status` — or take it offline.
 *
 * The project's live state is read ON DEMAND (decision 13), so the dialog
 * never paints a mode before that read settles: while it is in flight it
 * shows a loading description and no form at all, exactly the guard that
 * fixed 068's claim-vs-change race. Content is mounted only while open, so
 * every reopen re-reads rather than trusting a stale mode.
 */
export function PublishSiteDialog(props: PublishSiteDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <PublishSiteContent {...props} />}
    </Dialog>
  );
}

/** What the on-demand read answered — "error" is not "draft". */
type LoadPhase =
  | { phase: "loading" }
  | { phase: "ready"; state: ProjectPublishState }
  | { phase: "error" };

function PublishSiteContent({
  project,
  entries,
  memberships,
  onOpenChange,
  onStateChanged,
}: PublishSiteDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user } = useAuth();
  const supabase = useMemo(() => asPublishClient(createClient()), []);

  const [load, setLoad] = useState<LoadPhase>({ phase: "loading" });
  // `draft ?? derived`: the box shows the server's handle until the user
  // types, and a cleared box stays cleared (controlled-input-drafts).
  const [draft, setDraft] = useState<string | null>(null);
  const [check, setCheck] = useState<{
    value: string;
    available: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getProjectPublishState(supabase, project.id).then((state) => {
      if (cancelled) return;
      setLoad(state === null ? { phase: "error" } : { phase: "ready", state });
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, project.id]);

  const state = load.phase === "ready" ? load.state : null;
  const published = state?.status === PROJECT_PUBLISH_STATUS.published;
  const currentHandle = state?.handle ?? null;
  const handle = draft ?? currentHandle ?? project.slug;

  const valid = isValidSlug(handle);
  // The registry owns route meaning (069 task 2) — reserved segments are
  // checked there, not per surface, so this can never drift from the arbiter.
  const reserved = isReservedRoute(handle);

  // Debounced availability probe against the ARBITER, for the HANDLE kind.
  // The verdict shown is derived below (checked.value !== handle ⇒ still
  // checking) — no setState in the effect body.
  useEffect(() => {
    if (!valid || reserved) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void isSlugAvailable(supabase, handle, ROUTE_CLAIM_KINDS.handle).then(
        (available) => {
          if (!cancelled) setCheck({ value: handle, available });
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, valid, reserved, supabase]);

  const status = slugStatus({
    value: handle,
    valid,
    reserved,
    checked: check,
  });

  const canPublish =
    load.phase === "ready" && status === "available" && !busy && user !== null;

  const handleSubmit = async (): Promise<void> => {
    if (!user) return;
    setBusy(true);
    const result = await publishProject(
      supabase,
      user.id,
      project,
      entries,
      memberships,
      handle,
    );
    setBusy(false);
    if (!result.ok) {
      if (result.handleTaken) {
        setCheck({ value: handle, available: false });
        toast.error(t("publish.takenToast"));
      } else if (result.issue !== undefined) {
        // Decision 20: the publish was refused BEFORE any write — say why.
        toast.error(t(ISSUE_MESSAGE_KEY[result.issue]));
      } else {
        toast.error(t("publish.error"));
      }
      return;
    }
    toast.success(
      t("publish.sitePublished", {
        url: `${window.location.origin}/${locale}/${handle}`,
      }),
    );
    onStateChanged({
      status: PROJECT_PUBLISH_STATUS.published,
      handle,
      publishedAt: result.publishedAt ?? new Date().toISOString(),
    });
    // Task 5 (decision 21): the publish succeeded — fire the per-route bake
    // as fire-and-forget, mirroring the go-live dialog. Best-effort: it
    // filters to the static subset and serving degrades to client render
    // until a bake lands.
    if (result.baked !== undefined) {
      void bakeProjectEntryPoints(project.id, result.baked);
    }
    onOpenChange(false);
  };

  const handleUnpublish = async (): Promise<void> => {
    setBusy(true);
    const result = await unpublishProject(supabase, project.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(t("publish.error"));
      return;
    }
    toast.success(t("publish.siteUnpublished"));
    // The handle CLAIM is kept (decision 14) — only the entry points,
    // redirects and status changed.
    onStateChanged({
      status: PROJECT_PUBLISH_STATUS.draft,
      handle: currentHandle,
      publishedAt: state?.publishedAt ?? null,
    });
    onOpenChange(false);
  };

  const description =
    load.phase === "loading"
      ? t("publish.siteLoading")
      : load.phase === "error"
        ? t("publish.siteUnavailable")
        : published
          ? t("publish.siteLive", { handle: currentHandle ?? handle })
          : t("publish.siteDescription");

  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>
          {t("publish.siteTitle", { name: project.name })}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {load.phase === "ready" && (
        <div className="space-y-2">
          <label htmlFor="publish-site-handle" className="text-sm font-medium">
            {t("publish.siteHandleLabel")}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">/{locale}/</span>
            <Input
              id="publish-site-handle"
              value={handle}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              // Handles are lowercase by contract (projects_handle_check) —
              // fold as you type instead of rejecting capitals outright.
              onChange={(event) => setDraft(event.target.value.toLowerCase())}
            />
          </div>
          <p
            className={`text-xs ${SLUG_STATUS_CLASS[status]}`}
            aria-live="polite"
          >
            {t(SLUG_STATUS_TEXT[status])}
          </p>
        </div>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <div>
          {load.phase === "ready" && published && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void handleUnpublish()}
            >
              {t("publish.unpublish")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("historyDrawer.close")}
          </Button>
          {load.phase === "ready" && (
            <Button
              type="button"
              disabled={!canPublish}
              onClick={() => void handleSubmit()}
            >
              {busy
                ? t("publish.publishing")
                : published
                  ? t("publish.update")
                  : t("publish.submit")}
            </Button>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
