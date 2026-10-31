import { useEffect, useLayoutEffect, useRef } from "react";
import { useStateStore } from "@json-render/react";
import {
  getSessionState,
  setSessionState,
  stampSessionValue,
  subscribeProjects,
} from "@/lib/projects/projects";

/** Trailing debounce for the `/session` write-through (061 A3). */
const SESSION_WRITE_DEBOUNCE_MS = 300;

/**
 * The store → state pull runs as a LAYOUT effect so the value lands before
 * paint (no frame of empty `$state:/session/...` bindings on mount, screen
 * change or Activity re-show). The server never runs effects, and the
 * fallback avoids React's "useLayoutEffect on the server" warning.
 */
const useStorePullEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** JSON key for content comparison — how the value round-trips via storage. */
function keyOf(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * SessionSync (plan 061-4, A3 decision 5) — the SOLE bridge for the shared
 * `/session` subtree. Mounted inside `JSONUIProvider` next to `<QueryLoader>`
 * on the two project-scoped surfaces (editor + preview) whenever the screen
 * belongs to a project.
 *
 * Seeds deliberately do NOT carry `session` (see `omitSessionState`): the
 * provider's `initialState` diff deletes the key on every screen change, so
 * this component owns the subtree end to end.
 *
 * - **Store → state** — layout effect (re-runs on mount, screen change and
 *   Activity re-show) plus a store subscription while visible: the store
 *   wins whenever it differs, unless a local write of exactly the value on
 *   screen is in flight. Under Next 16's `<Activity>` (plan 059) a restored
 *   route keeps its old state, so this pull is what reconciles it with what
 *   a later screen wrote through.
 * - **State → store** — trailing debounce, declared FIRST so a genuine
 *   local change is pending before the pull could mistake it for stale
 *   state. Only LOCAL changes arm a write: values the pull just set are
 *   echoes (`expectedKey`) and `undefined` (the post-switch seed) never
 *   arm. Every value carries a monotonic stamp and the store rejects
 *   anything not strictly newer than its last accepted write, so a stale
 *   hidden instance's late flush can never clobber a fresher value,
 *   regardless of arrival order.
 * - **Hide/unmount flush** — Activity runs effect cleanups when a route is
 *   hidden (preserving-ui-state.md), so a navigation inside the debounce
 *   window still lands the pending write; the pull re-syncs state after.
 *
 * No project → the component is never mounted: screen-local state is never
 * bridged.
 */
export function SessionSync({ projectId }: { projectId: string | null }) {
  const { state, set, getSnapshot } = useStateStore();
  const session = (state as { session?: unknown } | null | undefined)?.session;
  const pendingRef = useRef<{
    projectId: string;
    session: unknown;
    stamp: number;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Content known to have come FROM the store (pull results, accepted
   *  writes) — echoing it back would only race the store against itself. */
  const expectedKeyRef = useRef(keyOf(session));

  /** Store → state: the store wins, except while a local write of exactly
   *  the value currently on screen is in flight (it is about to land). */
  const pullFromStore = (): void => {
    if (!projectId) return;
    const stored = getSessionState(projectId);
    if (stored === undefined) return;
    const storedKey = keyOf(stored);
    const liveKey = keyOf((getSnapshot() as { session?: unknown }).session);
    if (liveKey === storedKey) {
      expectedKeyRef.current = storedKey;
      return;
    }
    const pending = pendingRef.current;
    if (
      pending &&
      pending.projectId === projectId &&
      keyOf(pending.session) === liveKey
    ) {
      return;
    }
    set("/session", stored);
    expectedKeyRef.current = storedKey;
  };
  // Latest-iteration handle for the effects below (assigned in an effect —
  // react-hooks/refs forbids render-time ref writes; declared FIRST so every
  // other effect and the []-deps flush see the current closure).
  const pullRef = useRef(pullFromStore);
  useStorePullEffect(() => {
    pullRef.current = pullFromStore;
  });

  // State → store (layout, DECLARED FIRST): trailing debounce of LOCAL
  // changes — a local change must be pending before the pull below could
  // read it as stale state and revert it.
  useStorePullEffect(() => {
    if (!projectId || session === undefined) return;
    if (keyOf(session) === expectedKeyRef.current) return;
    // Switching projects inside one provider: land the old target first so
    // the previous project keeps what its screens wrote.
    const prior = pendingRef.current;
    if (prior && prior.projectId !== projectId) {
      setSessionState(prior.projectId, prior.session, prior.stamp);
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const target = { projectId, session, stamp: stampSessionValue() };
    pendingRef.current = target;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      setSessionState(target.projectId, target.session, target.stamp);
      // Accepted → the pull re-marks `expected` (no echo); rejected → a
      // fresher value already won, so the pull heals this screen from it.
      pullRef.current();
    }, SESSION_WRITE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [projectId, session]);

  // Store → state (layout, AFTER the debounce above): mount, screen change
  // (the seed just deleted `/session`), Activity re-show — plus the store
  // subscription so a write landing anywhere else heals a VISIBLE screen.
  useStorePullEffect(() => {
    pullRef.current();
    if (!projectId) return;
    return subscribeProjects(() => pullRef.current());
  }, [projectId, session]);

  // Hide/unmount flush — effect cleanups run when Activity hides the route,
  // so a navigation inside the debounce window still lands the pending
  // write. The stamp guard makes a stale instance's flush a no-op; the pull
  // re-syncs state to whatever won either way.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        setSessionState(pending.projectId, pending.session, pending.stamp);
      }
      pullRef.current();
    },
    [],
  );

  return null;
}
