"use client";

import { useEffect, useRef } from "react";
import { useActions, useStateStore } from "@json-render/react";
import type { Project } from "@/lib/projects/projects";
import {
  NAVIGATE_ACTION,
  runNavigate,
  type NavigateContext,
  type ScreenScope,
  type ScreenSource,
} from "@/lib/projects/screen-nav";

/**
 * Runtime `navigate` handler (plan 061, decision 4 + 061-3 params): mounted
 * **inside** each surface's `JSONUIProvider` (the `registerHandler` seam,
 * same as `QueryLoader`'s `data_mutate`) so it can deref `$item` path params
 * against the live state snapshot — a handler passed through the `handlers`
 * prop lives outside the provider and has no snapshot to read.
 *
 * The dispatch body sits behind a ref re-synced every render (the stable-once
 * seam the other handlers use): registration happens once, but `entries`,
 * `scope` and the playground's stream guard always reflect the committed
 * render — a stale closure would navigate with the previous screen's scope.
 *
 * Renders nothing.
 */
export interface NavigateHandlerProps {
  /** Route form the surface pushes (editor `/ui/…`, preview `/{locale}/…`). */
  surface: NavigateContext["surface"];
  /** Entries resolved at CLICK time — history can move under the screen. */
  entries: () => readonly ScreenSource[];
  /** Scope resolved at CLICK time (current entry → active project → bucket). */
  scope: () => ScreenScope;
  /** Route locale — required by `preview`, ignored by the editor. */
  locale?: string;
  /**
   * Project route namespace (061-3) — preview passes it; the editor's `/ui`
   * route ignores the namespace and `live` stays flat (published rows carry
   * no projectId — multi-screen publishing is F18).
   */
  projects?: readonly Project[];
  /** The surface's push (i18n router on authoring surfaces). */
  navigate: (route: string) => void;
  /** Skip dispatch entirely (playground: while a stream is running). */
  guard?: () => boolean;
  /** Result of every dispatch (playground: toast on a failed ref). */
  onResult?: (ok: boolean) => void;
}

export function NavigateHandler(props: NavigateHandlerProps) {
  // Stable identities on the provider — safe effect deps (QueryLoader).
  const { registerHandler } = useActions();
  const { getSnapshot } = useStateStore();
  const latest = useRef<NavigateHandlerProps>(props);
  // Re-sync every render, no dep array (the stable-once seam the surface
  // handlers use): registration below happens once, but the dispatch body
  // always reads the committed props.
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    registerHandler(NAVIGATE_ACTION, (params: Record<string, unknown>) => {
      const current = latest.current;
      if (current.guard && !current.guard()) return;
      const ok = runNavigate(params, {
        entries: current.entries(),
        scope: current.scope(),
        surface: current.surface,
        locale: current.locale,
        projects: current.projects,
        state: getSnapshot(),
        navigate: current.navigate,
      });
      current.onResult?.(ok);
    });
    // registerHandler has no unregister — the whole ActionProvider unmounts
    // with this component (it renders null inside the provider's tree).
  }, [registerHandler, getSnapshot]);

  return null;
}
