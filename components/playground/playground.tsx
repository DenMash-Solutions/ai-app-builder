"use client";

import type { Spec } from "@json-render/core";
import {
  isNonEmptySpec,
  markDevtoolsActive,
  setByPath,
} from "@json-render/core";
import { JSONUIProvider, Renderer, useUIStream } from "@json-render/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { appDirectives } from "@/lib/computed/directives";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  CanvasDnd,
  EditPanel,
  HoverBadge,
  PickOverlay,
  XrayLabels,
  PANEL_TABS,
  type PanelTab,
} from "@/components/editor";
import { HistoryDrawer } from "@/components/history-drawer";
import { PromptBar, ToolRail, TopBar } from "@/components/playground";
import { SignupBanner } from "@/components/playground/signup-banner";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { FailureDialog } from "@/components/failure-dialog";
import {
  MOVE_DIRECTIONS,
  STRUCTURE_OPS,
  chainForKey,
  countKeyInstances,
  describeInstanceText,
  duplicateElement,
  findParentKey,
  freeformRevisionLabel,
  getAncestorPath,
  insertElement,
  moveElement,
  moveSibling,
  promptRevisionLabel,
  propertyRevisionLabel,
  removeElement,
  replaceProp,
  resolveInstanceScope,
  scopeInstruction,
  scopeTargetId,
  scopeTargetsInstruction,
  structureRevisionLabel,
  unwrapElement,
  wrapElement,
} from "@/lib/editor";
import type {
  InstanceChain,
  MoveDirection,
  PromptScopeTarget,
} from "@/lib/editor";
import { examplePropsFor } from "@/lib/playground/catalog";
import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";
import { getModel, setModel } from "@/lib/playground/model-store";
import {
  RATE_LIMIT_PATTERN,
  SERVICE_UNAVAILABLE_PATTERN,
  type ModelId,
} from "@/lib/playground/models";
import type { HistoryEntry } from "@/lib/history";
import {
  addEntry,
  canRedo,
  canUndo,
  clearHistory,
  commitRevision,
  createEntry,
  getHistory,
  getServerHistory,
  redoRevision,
  removeEntry,
  subscribeHistory,
  undoRevision,
  updateEntry,
} from "@/lib/history";
import { languageName } from "@/lib/i18n/languages";
import {
  hasLanguageSwitcher,
  withLanguageSwitcherOption,
} from "@/lib/i18n/language-switcher";
import { normalizeSpecCopy } from "@/lib/i18n/spec-normalize";
import { specsEqual } from "@/lib/utils";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";
import { AddLanguageDialog } from "@/components/playground/add-language-dialog";
import {
  SPEC_STATE_KEYS,
  availableLanguages,
  getCopy,
  mergeI18n,
  seedLocale,
} from "@/lib/i18n/spec-languages";
import { validateSpecI18n } from "@/lib/i18n/spec-coverage";
import {
  copyWriteTarget,
  hasOverlayLayer,
  resolveContentLang,
  writeContentLang,
} from "@/lib/i18n/content-lang";
import type { ContentLanguageSwitcherProps } from "@/components/content-language-switcher";

const EXAMPLE_PROMPT_LIST = Object.values(EXAMPLE_PROMPTS);

const PENDING_OP_KINDS = {
  generate: "generate",
  edit: "edit",
} as const;

type PendingOp =
  | { kind: typeof PENDING_OP_KINDS.generate; prompt: string }
  | {
      kind: typeof PENDING_OP_KINDS.edit;
      entryId: string;
      label: string;
    };

// Add-language toast id per target tag — loading, success, and failure all
// update the same toast entry instead of stacking.
const langToastId = (tag: string): string => `add-lang-${tag}`;

type RouteStatus = "pending" | "ready" | "missing";

interface PlaygroundProps {
  /** Entry ref (id or slug) from the `/ui/[ref]` route — absent on the `/` landing. */
  initialRef?: string;
}

export function Playground({ initialRef }: PlaygroundProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const routeRef = initialRef ?? null;
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistory,
    getServerHistory,
  );
  // The URL owns the active UI: the entry for the `/ui/[ref]` route comes
  // straight from the history store — resolved by id first (the stable
  // identity every pre-slug link uses), then by slug (short hand-typed
  // URLs). `undefined` = server snapshot (history is localStorage-only,
  // unknown during SSR/hydration); React re-renders with the client snapshot
  // after hydration, so the pending gate never mismatches. Store
  // subscriptions also cover cross-tab updates and the revision commits
  // below — no local activeId/restoredSpec copy to sync.
  const routeEntry = useSyncExternalStore(
    subscribeHistory,
    () =>
      routeRef === null
        ? null
        : (getHistory().find(
            (entry) => entry.id === routeRef || entry.slug === routeRef,
          ) ?? null),
    () => undefined,
  );
  const routeStatus: RouteStatus =
    routeRef === null
      ? "ready"
      : routeEntry === undefined
        ? "pending"
        : routeEntry === null
          ? "missing"
          : "ready";
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [dndMode, setDndMode] = useState(false);
  const [xrayMode, setXrayMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<InstanceChain | null>(
    null,
  );
  // Prompt scope: elements the next main-prompt steer is limited to — shown
  // as removable chips in the prompt bar, highlighted on the canvas. Deduped
  // by key + instance chain; cleared on route change (entry-scoped).
  const [scopeTargets, setScopeTargets] = useState<PromptScopeTarget[]>([]);
  // Content-language selection (session override). Null = fall through to the
  // device-persisted choice, then the spec's seed — resolved synchronously in
  // the memo below (no effect round-trip, no seed flash).
  const [langOverride, setLangOverride] = useState<string | null>(null);
  // "Add language…" collects the target tag in a dialog (any BCP-47 tag —
  // the ask feeds the model steer, never a hardcoded demo pool).
  const [addLangOpen, setAddLangOpen] = useState(false);
  // Add-language feedback: the model steer takes seconds while the canvas
  // still shows the seed (the layer doesn't exist yet) — track the in-flight
  // tag so the switcher pill can spin and the toasts can announce progress,
  // completion, and failure. Resolved in onComplete/onError and the failure
  // dialog's retry/dismiss handlers.
  const [pendingLang, setPendingLang] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>(PANEL_TABS.properties);
  const pendingOpRef = useRef<PendingOp | null>(null);
  const [failure, setFailure] = useState<{
    kind: "quota" | "service";
    message: string;
  } | null>(null);
  const lastRequestRef = useRef<{
    prompt: string;
    context: Record<string, unknown>;
  } | null>(null);
  // Pristine pre-steer spec for the no-op guard — the stream mutates
  // context.previousSpec in place (see the onComplete comment).
  const steerBaselineRef = useRef<Spec | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Element keys ([data-jr-key]) only render while devtools are marked
  // active — pick mode needs them for hit-testing and outlines.
  useEffect(() => markDevtoolsActive(), []);

  const activeEntry = routeEntry ?? null;

  const { spec, isStreaming, send, clear } = useUIStream({
    api: "/api/generate",
    onError: (streamError) => {
      // A failed fresh generation leaves the hook's empty spec mounted, which
      // hides the empty state — restore it. Failed edits keep their spec.
      if (!lastRequestRef.current?.context.previousSpec) clear();
      const message = streamError.message;
      if (RATE_LIMIT_PATTERN.test(message)) {
        // The dialog owns feedback here, and its retry replays the add —
        // drop the loading toast but keep pendingLang armed for the retry.
        if (pendingLang) toast.dismiss(langToastId(pendingLang));
        setFailure({ kind: "quota", message });
        return;
      }
      if (SERVICE_UNAVAILABLE_PATTERN.test(message)) {
        if (pendingLang) toast.dismiss(langToastId(pendingLang));
        setFailure({ kind: "service", message });
        return;
      }
      if (pendingLang) {
        // The in-flight op is the add (steers can't overlap) — announce the
        // language-specific failure instead of the generic one.
        const tag = pendingLang;
        toast.error(
          t("playground.langAddFailed", {
            name: languageName(tag, locale) ?? tag,
          }),
          { id: langToastId(tag), description: message },
        );
        setPendingLang(null);
        return;
      }
      toast.error(t("playground.generationFailed"), {
        description: message,
      });
    },
    onComplete: (completedSpec) => {
      const op = pendingOpRef.current;
      if (!op) return;

      // Defense in depth: a completion that never set the root (empty stream
      // the server failed to classify, non-JSONL output) is a failure, not a
      // generation — never commit it to history. pendingOpRef survives so the
      // dialog's retry can replay the request.
      if (
        op.kind === PENDING_OP_KINDS.generate &&
        !isNonEmptySpec(completedSpec)
      ) {
        clear();
        setFailure({ kind: "service", message: t("service.noSpec") });
        return;
      }

      // A steer that completes with the spec unchanged (truncated or
      // empty stream) would commit a no-op revision — treat it as a model
      // failure so the dialog offers switch-and-retry. pendingOpRef stays
      // intact so the retry replays the request. The baseline lives in its
      // own ref: useUIStream shallow-copies context.previousSpec into its
      // working spec, so in-place patch application mutates that object —
      // it cannot be trusted as the pre-steer snapshot.
      const baseline = steerBaselineRef.current;
      if (
        op.kind === PENDING_OP_KINDS.edit &&
        isNonEmptySpec(baseline) &&
        specsEqual(completedSpec, baseline)
      ) {
        // Same treatment as the quota/service failures: the dialog speaks
        // (and its retry replays the add), pendingLang stays armed.
        if (pendingLang) toast.dismiss(langToastId(pendingLang));
        setFailure({ kind: "service", message: t("service.noChanges") });
        return;
      }
      pendingOpRef.current = null;

      // Ingest seam (generate, steer, import): lift stray inline copy into
      // state.copy — non-blocking by design, the coverage flag rides on the
      // entry (createEntry/commitRevision recompute it).
      const { spec: normalizedSpec } = normalizeSpecCopy(completedSpec);

      if (op.kind === PENDING_OP_KINDS.generate) {
        const entry = createEntry(op.prompt, normalizedSpec);
        addEntry(entry);
        // The URL owns the active UI: the landing streams the generation,
        // then the committed entry takes over at /ui/[id] (the destination
        // remount restores the identical spec from the entry).
        router.push(`/ui/${entry.id}`);
        return;
      }

      const entry = getHistory().find(
        (candidate) => candidate.id === op.entryId,
      );
      if (!entry) {
        // Revision target vanished mid-stream — the add can't land; fail
        // loudly rather than leaving the loading toast and spinner hanging.
        if (pendingLang) {
          const tag = pendingLang;
          toast.error(
            t("playground.langAddFailed", {
              name: languageName(tag, locale) ?? tag,
            }),
            { id: langToastId(tag) },
          );
          setPendingLang(null);
        }
        return;
      }
      // An add-language steer owns the design's own switcher too: the model
      // was told to offer the new option — this fix-up guarantees it even if
      // the stream missed the element change (pure, so it no-ops when the
      // model already did it).
      const specToCommit = pendingLang
        ? withLanguageSwitcherOption(normalizedSpec, pendingLang, true)
        : normalizedSpec;
      const updated = commitRevision(entry, specToCommit, op.label);
      updateEntry(updated);
      if (pendingLang) {
        // The layer committed — resolve the loading toast and stop the
        // switcher's pill spinner.
        const tag = pendingLang;
        toast.success(
          t("playground.langAdded", {
            name: languageName(tag, locale) ?? tag,
          }),
          { id: langToastId(tag) },
        );
        setPendingLang(null);
      }
    },
  });

  // Every request records its payload so the failure dialog's retry can
  // replay it with the newly selected model (pendingOpRef still holds the
  // operation).
  const sendNow = (
    prompt: string,
    context: Record<string, unknown> = {},
  ): void => {
    lastRequestRef.current = { prompt, context };
    // The route locale seeds the generation contract: copy is written in
    // this language, translations ship under state.i18n.<tag>.
    void send(prompt, { ...context, model: getModel(), locale });
  };

  // While a stream runs (generate on the landing, steer on /ui/[id]) the
  // hook's evolving spec wins; otherwise the committed entry's spec is the
  // source of truth. Falling back to `spec` covers the frame between a
  // landing generation's completion and the /ui/[id] navigation.
  const displayedSpec = isStreaming ? spec : (routeEntry?.spec ?? spec);
  // Runtime classes: spec classNames exist only at runtime — compile any not
  // yet covered via /api/tailwind and inject the CSS (no-op on failure).
  useRuntimeClasses(displayedSpec);
  // Derived render copy: carousels get scroll-container classes and
  // width-definite ancestors (see scroll-layout-fixup) without mutating what
  // the model produced or what editing/history operate on.
  const renderSpec = displayedSpec ? fixupScrollLayout(displayedSpec) : null;

  // Content language (playground editor): the active tag drives the canvas
  // merge, the EditPanel's resolved values, and where copy edits are written.
  const hasCopy = Object.keys(getCopy(displayedSpec?.state)).length > 0;
  const seedLang = seedLocale(displayedSpec?.state);
  const languages = useMemo(
    () => (displayedSpec ? availableLanguages(displayedSpec) : [seedLang]),
    [displayedSpec, seedLang],
  );
  const contentLang = useMemo(
    () =>
      resolveContentLang(displayedSpec, activeEntry?.id ?? null, langOverride),
    [displayedSpec, activeEntry, langOverride],
  );
  // The canvas renders the merged language over the seed copy.
  const canvasState = useMemo(() => {
    if (!displayedSpec) return {};
    const merged = mergeI18n(displayedSpec.state, contentLang) ?? {};
    // The design's language switcher highlights state.locale — keep it on
    // the language the canvas actually renders (the provider diffs this
    // into its runtime state; the stored spec is never touched).
    return SPEC_STATE_KEYS.locale in merged
      ? { ...merged, [SPEC_STATE_KEYS.locale]: contentLang }
      : merged;
  }, [displayedSpec, contentLang]);
  // The design's own switcher writes state.locale at runtime — treat that as
  // a content-language selection so canvas and pill always agree (the pill's
  // onChange does the same in reverse). Only real tags the spec carries
  // count; every other state change is view noise and ignored.
  const handleCanvasStateChange = (
    changes: Array<{ path: string; value: unknown }>,
  ) => {
    const change = changes.find(
      (candidate) =>
        candidate.path.replace(/^\//, "") === SPEC_STATE_KEYS.locale,
    );
    if (!change) return;
    const tag = change.value;
    if (typeof tag !== "string" || tag === contentLang || isStreaming) return;
    if (!languages.includes(tag)) return;
    setLangOverride(tag);
    writeContentLang(activeEntry?.id ?? null, tag);
  };
  const missingByTag = useMemo(() => {
    const counts = new Map<string, number>();
    const report = validateSpecI18n(displayedSpec?.state);
    for (const tag of report.tags) {
      if (tag.valid && !tag.redundant && tag.missing.length > 0) {
        counts.set(tag.tag, tag.missing.length);
      }
    }
    return counts;
  }, [displayedSpec]);
  // "Revert to source" only when the active (non-seed) language has an overlay.
  const canRevert =
    contentLang !== seedLang &&
    hasOverlayLayer(displayedSpec?.state, contentLang);

  // Derived selection: stale keys (removed by a patch/undo) simply read as
  // unselected — no effect round trip needed.
  const effectiveKey =
    selectedKey && displayedSpec?.elements[selectedKey] ? selectedKey : null;
  const selectedElement =
    displayedSpec && effectiveKey
      ? displayedSpec.elements[effectiveKey]
      : undefined;
  const ancestors =
    displayedSpec && effectiveKey
      ? getAncestorPath(displayedSpec, effectiveKey)
      : [];
  // Live prompt scope: drop targets whose element left the spec (patch/undo)
  // — same derivation style as effectiveKey, no effect round trip.
  const scopedTargets = useMemo(
    () =>
      displayedSpec
        ? scopeTargets.filter((target) => displayedSpec.elements[target.key])
        : [],
    [displayedSpec, scopeTargets],
  );
  // Id set for the x-ray labels' ✓/`+` toggle — same identity function as
  // the prompt bar and the selection chip, so membership can't drift.
  const scopeIds = useMemo(
    () => new Set(scopedTargets.map((target) => scopeTargetId(target))),
    [scopedTargets],
  );
  // Slugs taken by *other* entries — the rename popover blocks a save that
  // would collide with any of them.
  const takenSlugs = useMemo(
    () =>
      new Set(
        history
          .filter((entry) => entry.id !== activeEntry?.id)
          .map((entry) => entry.slug),
      ),
    [history, activeEntry],
  );
  const selectionInScope =
    effectiveKey !== null &&
    scopedTargets.some((target) => {
      if (target.key !== effectiveKey) return false;
      // A template (or singleton) target covers any selection of its key.
      if ((target.chain?.length ?? 0) === 0) return true;
      return (
        scopeTargetId(target) ===
        scopeTargetId({ key: effectiveKey, chain: selectedChain })
      );
    });
  const selectedInstanceCount =
    displayedSpec && effectiveKey
      ? countKeyInstances(displayedSpec, effectiveKey)
      : 0;
  const templateInScope =
    effectiveKey !== null &&
    selectedInstanceCount > 1 &&
    scopedTargets.some(
      (target) =>
        target.key === effectiveKey && (target.chain?.length ?? 0) === 0,
    );

  // Edit drawer lifecycle: the close is *delayed*, not the unmount — while
  // `panelClosing` is true the selection stays alive, so the panel keeps
  // rendering from live props and can play its exit animation; only when
  // its `onExited` fires does the real close (`clearSelection`) run. The
  // visibility condition widens with `(pickMode || panelClosing)` so even
  // toggling Pick off animates the panel out instead of popping it.
  const [panelClosing, setPanelClosing] = useState(false);
  const panelTarget =
    displayedSpec &&
    !isStreaming &&
    effectiveKey &&
    selectedElement &&
    (pickMode || panelClosing)
      ? {
          // The panel resolves bindings against the merged language so the
          // fields show (and target) the active content language, not the seed.
          spec: { ...displayedSpec, state: canvasState },
          elementKey: effectiveKey,
          element: selectedElement,
        }
      : null;
  const beginPanelClose = () => {
    if (panelTarget) setPanelClosing(true);
  };
  // A stream/clear/spec swap can drop `panelTarget` mid-exit (the panel
  // unmounts before `onExited`); reset the flag so the next open is not stuck
  // in the closing state.
  if (!panelTarget && panelClosing) setPanelClosing(false);

  // Crossing routes (or landing ↔ /ui/[id]) swaps the whole entry — drop
  // any selection tied to the previous one. Guarded render-time adjustment
  // (the react.dev "adjusting state when a prop changes" pattern): the
  // panelClosing state above must exist before this runs.
  const [prevRouteRef, setPrevRouteId] = useState(routeRef);
  if (prevRouteRef !== routeRef) {
    setPrevRouteId(routeRef);
    setSelectedKey(null);
    setSelectedChain(null);
    setPanelClosing(false);
    setScopeTargets([]);
  }

  // The selection carries the repeat scopes captured at pick time so data
  // edits scope to the clicked instance. Key navigation keeps the levels that
  // still apply; structural ops clear the chain (they edit the template).
  const clearSelection = () => {
    setSelectedKey(null);
    setSelectedChain(null);
    setPanelClosing(false);
  };

  const handlePick = useCallback(
    (key: string | null, chain: InstanceChain | null) => {
      setSelectedKey(key);
      setSelectedChain(chain);
      setPanelClosing(false);
    },
    [],
  );

  // Double-click on any canvas element: enter pick mode and open the editor
  // for the exact instance under the cursor.
  const handleActivate = useCallback(
    (key: string, chain: InstanceChain | null) => {
      setPickMode(true);
      handlePick(key, chain);
    },
    [handlePick],
  );

  // Shift+click (pick armed) and the drawer toggles both flip membership.
  // Per-key exclusivity: a template target and instance targets of the same
  // key contradict each other, so adding either drops the other side.
  // Removal of an element's scope targets — the chip's X button removes the
  // pin AND drops scope. Unlike toggle, this clears every target for the key
  // (both the shared template `key|null` and any instance-specific `key|chain`)
  // so no dangling scope lingers after the chip is gone.
  const removeScope = useCallback((key: string) => {
    setScopeTargets((prev) => prev.filter((entry) => entry.key !== key));
  }, []);
  const handleToggleScope = useCallback(
    (key: string, chain: InstanceChain | null, template = false) => {
      setScopeTargets((prev) => {
        const count = displayedSpec ? countKeyInstances(displayedSpec, key) : 1;
        const asTemplate = template && count > 1;
        const target: PromptScopeTarget = {
          key,
          chain: asTemplate ? null : chain,
        };
        const id = scopeTargetId(target);
        const exists = prev.some((entry) => scopeTargetId(entry) === id);
        if (asTemplate) {
          const kept = prev.filter((entry) => entry.key !== key);
          return exists ? kept : [...kept, target];
        }
        if (exists) {
          return prev.filter((entry) => scopeTargetId(entry) !== id);
        }
        const kept = prev.filter(
          (entry) => !(entry.key === key && (entry.chain?.length ?? 0) === 0),
        );
        return [...kept, target];
      });
    },
    [displayedSpec],
  );

  const handleSelectKey = (key: string) => {
    setPanelClosing(false);
    setSelectedKey(key);
    setSelectedChain((chain) =>
      displayedSpec && chain ? chainForKey(displayedSpec, chain, key) : null,
    );
  };

  // Main input: edits the displayed result (steer), generates when empty.
  // A non-empty prompt scope wraps the instruction so the model patches
  // exactly the scoped elements (with their instance paths).
  const handleSend = (prompt: string) => {
    const base = displayedSpec;
    if (base?.root && activeEntry) {
      pendingOpRef.current = {
        kind: PENDING_OP_KINDS.edit,
        // The URL ref may be a slug — the revision commit looks the entry
        // up by id, so record the stable identity.
        entryId: activeEntry.id,
        label: promptRevisionLabel(prompt),
      };
      steerBaselineRef.current = structuredClone(base);
      const instruction =
        scopedTargets.length > 0
          ? scopeTargetsInstruction(base, scopedTargets, prompt)
          : prompt;
      sendNow(instruction, { previousSpec: structuredClone(base) });
      return;
    }
    handleGenerate(prompt);
  };

  // Example chips always start a fresh generation in their own entry.
  const handleGenerate = (prompt: string) => {
    pendingOpRef.current = {
      kind: PENDING_OP_KINDS.generate,
      prompt,
    };
    steerBaselineRef.current = null;
    sendNow(prompt);
  };

  const handleSelect = (entry: HistoryEntry) => {
    // Navigation remounts the playground on the entry's URL — the route
    // snapshot there is the activation.
    setHistoryOpen(false);
    router.push(`/ui/${entry.id}`);
  };

  // Rename the active entry (top-bar title popover). The slug feeds the
  // preview route /{locale}/{slug} — renaming it invalidates the old URL
  // (no redirects; a stale slug hits the not-found panel).
  const handleRename = (name: string, slug: string) => {
    if (!activeEntry) return;
    updateEntry({ ...activeEntry, name, slug });
  };

  // Imported JSON becomes its own history entry (steer/pick/edits all
  // require an active entry), then activates like a history selection.
  // The import lives in the history drawer, which closes once the spec
  // is on canvas.
  const handleImportSpec = (importedSpec: Spec) => {
    const { spec: normalized } = normalizeSpecCopy(importedSpec);
    const entry = createEntry(t("playground.importedEntry"), normalized);
    addEntry(entry);
    setHistoryOpen(false);
    router.push(`/ui/${entry.id}`);
  };

  const handleDelete = (id: string) => {
    removeEntry(id);
    if (activeEntry?.id === id) {
      // Deleting the open entry leaves nothing addressable — fall back to
      // the playground landing (navigation also drops any stale canvas
      // state). The root itself is featured content, not the playground.
      router.push("/ui");
    }
  };

  const handleClear = () => {
    clearHistory();
    router.push("/ui");
  };

  const handleClearCurrent = () => {
    clear();
    router.push("/ui");
  };

  const handleTogglePick = () => {
    if (pickMode) beginPanelClose();
    setPickMode(!pickMode);
  };

  const handleAction = (instruction: string, label: string) => {
    const base = displayedSpec;
    if (!base?.root || !selectedKey || !activeEntry || isStreaming) return;
    const element = base.elements[selectedKey];
    if (!element) return;
    pendingOpRef.current = {
      kind: PENDING_OP_KINDS.edit,
      entryId: activeEntry.id,
      label,
    };
    steerBaselineRef.current = structuredClone(base);
    sendNow(
      scopeInstruction(
        selectedKey,
        element.type,
        instruction,
        resolveInstanceScope(base, base.state ?? {}, selectedChain ?? []),
      ),
      {
        previousSpec: structuredClone(base),
      },
    );
  };

  // Whole-spec steer (no element scope) — the translation actions patch every
  // language layer at once, so they must not be scoped to a selected element.
  // Returns whether the stream actually started (guards may refuse it).
  const steerWholeSpec = (instruction: string, label: string): boolean => {
    const base = displayedSpec;
    if (!base?.root || !activeEntry || isStreaming) return false;
    pendingOpRef.current = {
      kind: PENDING_OP_KINDS.edit,
      entryId: activeEntry.id,
      label,
    };
    steerBaselineRef.current = structuredClone(base);
    sendNow(instruction, { previousSpec: structuredClone(base) });
    return true;
  };

  // Model action: translate the whole spec into the language the user asked
  // for (the dialog hands over the canonical tag), then switch the canvas to
  // it once the layer lands. A tag the spec already carries just switches —
  // nothing to translate.
  const handleAddLanguage = (tag: string) => {
    setLangOverride(tag);
    if (activeEntry) writeContentLang(activeEntry.id, tag);
    if (languages.includes(tag)) return;
    // The design's own language switcher (a ButtonGroup of language codes)
    // must offer the new language as well — the completion fix-up enforces
    // it, but asking the model keeps the whole change in one revision.
    const switcherHint =
      displayedSpec && hasLanguageSwitcher(displayedSpec)
        ? ` Also update the design's language-switcher ButtonGroup: append {"label": "${tag.toUpperCase()}", "value": "${tag}"} to its props.buttons, keeping every existing button exactly as it is.`
        : "";
    const started = steerWholeSpec(
      `Add a full translation of this spec into the language with BCP-47 tag "${tag}". For every key in state.copy, add a translated value under state.i18n.${tag} with the identical key, keeping every $state reference unchanged. Do not modify state.copy or any other language.${switcherHint}`,
      freeformRevisionLabel(`add ${tag}`),
    );
    if (!started) return;
    // Feedback for the seconds the model needs: a loading toast plus the
    // switcher's pill spinner (pendingTag) until the completion/error
    // handlers resolve it.
    const name = languageName(tag, locale) ?? tag;
    setPendingLang(tag);
    toast.loading(t("playground.addingLang", { name }), {
      id: langToastId(tag),
    });
  };

  // Model action: fill the active language's missing translations only.
  const handleTranslateMissing = () => {
    steerWholeSpec(
      `For the content language with tag "${contentLang}", add a translated value under state.i18n.${contentLang} for every state.copy key that does not already have one. Do not change state.copy, other languages, or any $state reference.`,
      freeformRevisionLabel(`translate ${contentLang}`),
    );
  };

  // Local op: drop the active language's overlay layer → seed fallback.
  const handleRevertToSource = () => {
    if (!displayedSpec || !routeEntry || isStreaming) return;
    const next = structuredClone(displayedSpec);
    const i18n = next.state?.i18n;
    if (i18n && typeof i18n === "object") {
      delete (i18n as Record<string, unknown>)[contentLang];
      if (Object.keys(i18n).length === 0 && next.state) delete next.state.i18n;
    }
    // A language that no longer exists must not stay offered by the design's
    // own switcher (the seed button never goes anywhere).
    const synced =
      contentLang === seedLang
        ? next
        : withLanguageSwitcherOption(next, contentLang, false);
    const updated = commitRevision(
      routeEntry,
      synced,
      freeformRevisionLabel(`revert ${contentLang}`),
    );
    updateEntry(updated);
  };

  // Local op: remove a language entirely (any row, not just the active one).
  // The seed is never removable — it IS the copy; removing the active layer
  // falls back to it. The design's own switcher loses the option with it.
  const handleRemoveLanguage = (tag: string) => {
    if (!displayedSpec || !routeEntry || isStreaming || tag === seedLang)
      return;
    const next = structuredClone(displayedSpec);
    const i18n = next.state?.i18n;
    if (i18n && typeof i18n === "object") {
      delete (i18n as Record<string, unknown>)[tag];
      if (Object.keys(i18n).length === 0 && next.state) delete next.state.i18n;
    }
    const updated = commitRevision(
      routeEntry,
      withLanguageSwitcherOption(next, tag, false),
      freeformRevisionLabel(`remove ${tag}`),
    );
    updateEntry(updated);
    if (contentLang === tag) {
      setLangOverride(seedLang);
      if (activeEntry) writeContentLang(activeEntry.id, seedLang);
    }
  };

  const handleFailureConfirm = (model: ModelId) => {
    setModel(model);
    setFailure(null);
    // A retried add re-arms its loading toast (the error path dismissed it).
    if (pendingLang) {
      toast.loading(
        t("playground.addingLang", {
          name: languageName(pendingLang, locale) ?? pendingLang,
        }),
        { id: langToastId(pendingLang) },
      );
    }
    const last = lastRequestRef.current;
    if (last) sendNow(last.prompt, last.context);
  };

  // Dismissing without retrying surfaces the original failure as a toast.
  const handleFailureOpenChange = (open: boolean) => {
    if (!open) {
      if (pendingLang) {
        // The add will never land — its own failure copy, and the pending
        // state clears so the pill spinner stops.
        const tag = pendingLang;
        toast.error(
          t("playground.langAddFailed", {
            name: languageName(tag, locale) ?? tag,
          }),
          { id: langToastId(tag), description: failure?.message ?? "" },
        );
        setPendingLang(null);
      } else {
        toast.error(t("playground.generationFailed"), {
          description: failure?.message ?? "",
        });
      }
      setFailure(null);
    }
  };

  const handlePropChange = (
    prop: string,
    value: unknown,
    dataPath: string | null,
  ) => {
    if (!displayedSpec || !selectedKey || !routeEntry || isStreaming) return;
    let next: Spec;
    if (dataPath !== null) {
      // Data-bound prop: write the instance's state path — the template prop
      // keeps its expression and other items stay untouched. A `/copy/*` edit
      // while a NON-seed language is active is redirected to that language's
      // i18n overlay (create-if-missing), leaving the seed copy intact.
      next = structuredClone(displayedSpec);
      next.state = next.state ?? {};
      setByPath(
        next.state,
        copyWriteTarget(dataPath, contentLang, seedLang),
        value,
      );
    } else {
      next = replaceProp(displayedSpec, selectedKey, prop, value);
    }
    const updated = commitRevision(
      routeEntry,
      next,
      propertyRevisionLabel(prop),
    );
    updateEntry(updated);
  };

  // Structural edits are local deterministic ops — same commit path as prop
  // edits (undoable revisions), with an explicit selection target so focus
  // follows the operation (insert→new, remove→parent, move→stay).
  const commitStructure = (
    next: Spec | null,
    label: string,
    selectKey?: string | null,
  ): void => {
    if (!next || !routeEntry) return;
    const updated = commitRevision(routeEntry, next, label);
    updateEntry(updated);
    // Structure ops shift instance positions — drop the chain so the panel
    // falls back to safe template-level editing instead of a stale index.
    setSelectedChain(null);
    if (selectKey !== undefined) setSelectedKey(selectKey);
  };

  const handleInsert = (parentKey: string, type: string) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    const result = insertElement(displayedSpec, {
      parentKey,
      type,
      props: examplePropsFor(type),
    });
    commitStructure(
      result?.spec ?? null,
      structureRevisionLabel(STRUCTURE_OPS.insert, type),
      result?.key,
    );
  };

  const handleRemove = (key: string) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    commitStructure(
      removeElement(displayedSpec, key),
      structureRevisionLabel(STRUCTURE_OPS.remove),
      findParentKey(displayedSpec, key),
    );
  };

  const handleGroup = (key: string, containerType: string) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    const result = wrapElement(
      displayedSpec,
      key,
      containerType,
      examplePropsFor(containerType),
    );
    commitStructure(
      result?.spec ?? null,
      structureRevisionLabel(STRUCTURE_OPS.group, containerType),
      result?.key,
    );
  };

  const handleUnwrap = (key: string) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    const element = displayedSpec.elements[key];
    const firstInner = element
      ? [
          ...(element.children ?? []),
          ...Object.values(element.slots ?? {}).flat(),
        ][0]
      : undefined;
    commitStructure(
      unwrapElement(displayedSpec, key),
      structureRevisionLabel(STRUCTURE_OPS.ungroup),
      firstInner ?? findParentKey(displayedSpec, key),
    );
  };

  const handleMove = (key: string, direction: MoveDirection) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    commitStructure(
      moveSibling(displayedSpec, key, direction),
      structureRevisionLabel(STRUCTURE_OPS.move),
    );
  };

  const handleMoveTo = (
    key: string,
    targetParentKey: string,
    index: number,
  ) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    commitStructure(
      moveElement(displayedSpec, { key, targetParentKey, index }),
      structureRevisionLabel(STRUCTURE_OPS.move),
    );
  };

  const handleDuplicate = (key: string) => {
    if (!displayedSpec || !activeEntry || isStreaming) return;
    const result = duplicateElement(displayedSpec, key);
    commitStructure(
      result?.spec ?? null,
      structureRevisionLabel(STRUCTURE_OPS.duplicate),
      result?.key,
    );
  };

  // The store subscription re-derives routeEntry (and with it displayedSpec)
  // after the commit — no local spec copy to refresh.
  const applyRevision = useCallback((entry: HistoryEntry) => {
    updateEntry(entry);
  }, []);

  const handleUndo = () => {
    if (activeEntry && canUndo(activeEntry)) {
      applyRevision(undoRevision(activeEntry));
    }
  };

  const handleRedo = () => {
    if (activeEntry && canRedo(activeEntry)) {
      applyRevision(redoRevision(activeEntry));
    }
  };

  // X-ray: tag container wrappers (children or slots) with a data attribute
  // the CSS in globals.css can target — keeps React out of the outline loop.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wrappers = container.querySelectorAll<HTMLElement>("[data-jr-key]");
    if (!xrayMode || !displayedSpec) {
      wrappers.forEach((wrapper) => {
        wrapper.removeAttribute("data-jr-container");
        wrapper.removeAttribute("data-jr-type");
      });
      return;
    }
    wrappers.forEach((wrapper) => {
      const element = wrapper.dataset.jrKey
        ? displayedSpec.elements[wrapper.dataset.jrKey]
        : undefined;
      const hasChildren =
        !!element &&
        ((element.children?.length ?? 0) > 0 ||
          Object.values(element.slots ?? {}).flat().length > 0);
      if (hasChildren) wrapper.setAttribute("data-jr-container", "1");
      else wrapper.removeAttribute("data-jr-container");
      // Type drives the x-ray family outline colors (globals.css) — set
      // alongside the container tag so paint stays CSS-only.
      if (element) wrapper.setAttribute("data-jr-type", element.type);
      else wrapper.removeAttribute("data-jr-type");
    });
  }, [xrayMode, displayedSpec]);
  // Keyboard shortcuts: Cmd+Z/Cmd+Shift+Z (undo/redo), Cmd+D (duplicate),
  // Alt+arrows (move sibling), Escape cascade (panel → pick off), and the
  // letter toggles P/X/G. Never while typing in a form field; mutating
  // shortcuts additionally need a live selection and no active stream. The
  // listener attaches once and reads the latest state/handlers through a
  // ref (same latest-value pattern as pendingOpRef) so it never
  // re-subscribes on every render.
  const shortcutsRef = useRef({
    activeEntry,
    isStreaming,
    effectiveKey,
    panelTarget,
    panelClosing,
    pickMode,
    applyRevision,
    handleDuplicate,
    handleMove,
    handleRemove,
    handleTogglePick,
    beginPanelClose,
  });
  useEffect(() => {
    shortcutsRef.current = {
      activeEntry,
      isStreaming,
      effectiveKey,
      panelTarget,
      panelClosing,
      pickMode,
      applyRevision,
      handleDuplicate,
      handleMove,
      handleRemove,
      handleTogglePick,
      beginPanelClose,
    };
  });

  useEffect(() => {
    const isFormField = (target: HTMLElement | null): boolean =>
      !!target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);

    const handleKeyDown = (event: KeyboardEvent) => {
      const {
        activeEntry,
        isStreaming,
        effectiveKey,
        panelTarget,
        panelClosing,
        pickMode,
        applyRevision,
        handleDuplicate,
        handleMove,
        handleRemove,
        handleTogglePick,
        beginPanelClose,
      } = shortcutsRef.current;
      const target = event.target as HTMLElement | null;
      const inField = isFormField(target);
      const command = event.metaKey || event.ctrlKey;

      if (command && event.key.toLowerCase() === "z") {
        if (inField) return;
        if (!activeEntry || isStreaming) return;
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo(activeEntry)) applyRevision(redoRevision(activeEntry));
        } else if (canUndo(activeEntry)) {
          applyRevision(undoRevision(activeEntry));
        }
        return;
      }

      if (command && event.key.toLowerCase() === "d") {
        if (inField || !effectiveKey || !activeEntry || isStreaming) return;
        event.preventDefault();
        handleDuplicate(effectiveKey);
        return;
      }

      if (
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        if (inField || !effectiveKey || !activeEntry || isStreaming) return;
        event.preventDefault();
        handleMove(
          effectiveKey,
          event.key === "ArrowUp" ? MOVE_DIRECTIONS.up : MOVE_DIRECTIONS.down,
        );
        return;
      }

      if (command || event.altKey) return;

      if (event.key === "Escape") {
        // The EditPanel's own Escape listener closes the panel (it runs
        // after this one, registered later); while a panel is open or
        // exiting, Escape belongs to it — this branch only turns Pick off
        // once nothing panel-related is in flight.
        if (event.defaultPrevented || panelTarget || panelClosing) return;
        if (pickMode) {
          beginPanelClose();
          setPickMode(false);
        }
        return;
      }

      if (inField) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!effectiveKey || !activeEntry || isStreaming) return;
        event.preventDefault();
        handleRemove(effectiveKey);
        return;
      }

      switch (event.key) {
        case "p":
          handleTogglePick();
          return;
        case "x":
          setXrayMode((prev) => !prev);
          return;
        case "g":
          setDndMode((prev) => !prev);
          return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  // Route gates: resolution runs client-side, so a deep link first paints
  // the neutral loading state (never the empty state or the error panel);
  // an unknown/deleted/foreign id explains itself instead of silently
  // redirecting. Both render the same shell surface (dot-grid main) so the
  // transition into the playground stays visually continuous.
  if (routeStatus === "pending") {
    return (
      <div className="dot-grid flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("uiRoute.loading")}</p>
      </div>
    );
  }
  if (routeStatus === "missing") {
    return (
      <div className="dot-grid flex h-[100dvh] w-full items-center justify-center px-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">
            {t("uiRoute.notFound.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("uiRoute.notFound.description")}
          </p>
          <Button asChild>
            <Link href="/">{t("uiRoute.notFound.back")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Content-language toggle: only shown when the spec has translatable copy.
  // Copy edits redirect per copyWriteTarget; add/translate are model steers
  // (add collects the target tag in a dialog); revert drops the active
  // overlay layer back to the seed.
  const contentLangProps: ContentLanguageSwitcherProps | null = hasCopy
    ? {
        languages,
        value: contentLang,
        seed: seedLang,
        pendingTag: pendingLang,
        missingByTag,
        onChange: (tag: string) => {
          setLangOverride(tag);
          writeContentLang(activeEntry?.id ?? null, tag);
        },
        onAddLanguage: () => setAddLangOpen(true),
        onRemoveLanguage: handleRemoveLanguage,
        onTranslateMissing: handleTranslateMissing,
        onRevertToSource: handleRevertToSource,
        canRevert,
      }
    : null;

  return (
    <JSONUIProvider
      registry={registry}
      initialState={canvasState}
      onStateChange={handleCanvasStateChange}
      handlers={{}}
      validationFunctions={{}}
      directives={appDirectives}
    >
      <div
        data-canvas
        className="dot-grid relative flex h-[100dvh] w-full flex-col overflow-hidden md:flex-row"
      >
        {/* Stage: holds all chrome and the canvas; shrinks when the
                  edit panel docks (right on desktop, bottom on mobile) so the
                  rail, prompt bar, and top bar are never covered. `isolate`
                  scopes the overlays' z-[1000] to this stage: x-ray/pick
                  decorations beat all canvas chrome (top bar, rail, prompt
                  bar) while dialogs outside the stage (z-50) still open
                  above them. */}
        <div className="relative isolate min-h-0 min-w-0 flex-1">
          <TopBar
            historyCount={history.length}
            onOpenHistory={() => setHistoryOpen(true)}
            entryId={activeEntry?.id ?? null}
            entryName={activeEntry?.name ?? null}
            entrySlug={activeEntry?.slug ?? null}
            takenSlugs={takenSlugs}
            onRename={handleRename}
            contentLang={contentLangProps}
          />
          {/* Landing only: while editing an entry the CTA would just
                    overlay the canvas the user is working on. */}
          {!activeEntry && <SignupBanner />}

          {displayedSpec && !isStreaming && (
            <ToolRail
              pickMode={pickMode}
              dndMode={dndMode}
              xrayMode={xrayMode}
              onTogglePick={handleTogglePick}
              onToggleDnd={() => setDndMode((prev) => !prev)}
              onToggleXray={() => setXrayMode((prev) => !prev)}
              onClear={handleClearCurrent}
            />
          )}

          <div
            ref={containerRef}
            className={`absolute inset-0 overflow-y-auto ${
              pickMode ? "jr-pick-enabled" : ""
            } ${xrayMode ? "jr-xray" : ""} ${
              dndMode && displayedSpec && !isStreaming ? "jr-dnd" : ""
            }`}
          >
            <div className="flex min-h-full flex-col px-6 pb-28 pt-20">
              {!displayedSpec && !isStreaming && (
                <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
                  <div className="w-full max-w-xl space-y-3">
                    <p className="text-balance text-muted-foreground">
                      {t("playground.subtitle")}
                    </p>
                    <p className="text-sm text-muted-foreground/80">
                      {t("playground.emptyState")}
                    </p>
                  </div>
                  <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-2">
                    {EXAMPLE_PROMPT_LIST.map((example) => (
                      <Button
                        key={example}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="max-w-full h-auto whitespace-normal break-words py-1.5"
                        onClick={() => handleGenerate(example)}
                      >
                        {example}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <Renderer
                spec={renderSpec}
                registry={registry}
                loading={isStreaming}
              />
              {/* Before PickOverlay: both attach capture listeners on the
              container, and listener order follows render order. */}
              <CanvasDnd
                enabled={dndMode && displayedSpec !== null && !isStreaming}
                containerRef={containerRef}
                spec={displayedSpec}
                onMoveTo={handleMoveTo}
              />
              <HoverBadge
                enabled={pickMode && !isStreaming && displayedSpec !== null}
                containerRef={containerRef}
                spec={displayedSpec}
              />
            </div>
          </div>

          {/* Both overlays mount after the scroll container, not inside
              it: absolutely-positioned decorations must not join the
              scroller's scrollable overflow (the selection ring used to
              inflate scrollWidth — a phantom horizontal scrollbar). Each is
              inset-0 on the stage with overflow-hidden, clipping decorations
              to the canvas box; trackers follow viewport rects, so scroll
              tracking is unchanged. XrayLabels renders under PickOverlay so
              the selection ring wins when both modes are on. */}
          <XrayLabels
            enabled={xrayMode && !isStreaming && displayedSpec !== null}
            containerRef={containerRef}
            spec={displayedSpec}
            pickArmed={pickMode && !isStreaming && displayedSpec !== null}
            scopeIds={scopeIds}
            onSelect={handlePick}
            onToggleScope={handleToggleScope}
            onRemoveScope={removeScope}
          />
          <PickOverlay
            enabled={pickMode && !isStreaming && displayedSpec !== null}
            containerRef={containerRef}
            spec={displayedSpec}
            selectedKey={effectiveKey}
            selectedChain={selectedChain}
            onSelect={handlePick}
            onActivate={isStreaming ? undefined : handleActivate}
            onToggleScope={handleToggleScope}
            scopeTargets={scopedTargets.map((target) => ({
              ...target,
              id: scopeTargetId(target),
              count:
                (target.chain?.length ?? 0) === 0 && displayedSpec
                  ? countKeyInstances(displayedSpec, target.key)
                  : undefined,
            }))}
            scopeLoading={isStreaming}
          />

          {failure && (
            <FailureDialog
              kind={failure.kind}
              onOpenChange={handleFailureOpenChange}
              onConfirm={handleFailureConfirm}
            />
          )}

          <AddLanguageDialog
            open={addLangOpen}
            onOpenChange={setAddLangOpen}
            onAdd={handleAddLanguage}
          />

          <PromptBar
            isStreaming={isStreaming}
            hasSpec={displayedSpec !== null}
            onSend={handleSend}
            scope={scopedTargets.map((target) => {
              const type =
                displayedSpec?.elements[target.key]?.type ?? target.key;
              const isTemplate = (target.chain?.length ?? 0) === 0;
              const count = displayedSpec
                ? countKeyInstances(displayedSpec, target.key)
                : 1;
              const instance =
                !isTemplate && displayedSpec
                  ? resolveInstanceScope(
                      displayedSpec,
                      displayedSpec.state ?? {},
                      target.chain ?? [],
                    )
                  : null;
              return {
                id: scopeTargetId(target),
                key: target.key,
                type,
                detail:
                  instance && displayedSpec
                    ? describeInstanceText(
                        displayedSpec,
                        target.key,
                        target.chain ?? [],
                      )
                    : null,
                instanceIndex: instance ? instance.itemIndex + 1 : null,
                label: instance
                  ? t("playground.scopeChipInstance", {
                      key: target.key,
                      type,
                      index: instance.itemIndex + 1,
                      count: instance.count,
                    })
                  : isTemplate && count > 1
                    ? t("playground.scopeChipAll", {
                        key: target.key,
                        type,
                        count,
                      })
                    : t("playground.scopeChip", {
                        key: target.key,
                        type,
                      }),
              };
            })}
            onRemoveScope={(id) =>
              setScopeTargets((prev) =>
                prev.filter((target) => scopeTargetId(target) !== id),
              )
            }
          />
        </div>

        {panelTarget && (
          <EditPanel
            closing={panelClosing}
            onExited={clearSelection}
            spec={panelTarget.spec}
            elementKey={panelTarget.elementKey}
            element={panelTarget.element}
            ancestors={ancestors}
            tab={panelTab}
            onTabChange={setPanelTab}
            canUndo={activeEntry !== null && canUndo(activeEntry)}
            canRedo={activeEntry !== null && canRedo(activeEntry)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClose={beginPanelClose}
            onSelectKey={handleSelectKey}
            instanceChain={selectedChain}
            onPropChange={handlePropChange}
            onAction={handleAction}
            onInsert={handleInsert}
            onRemove={handleRemove}
            onGroup={handleGroup}
            onUnwrap={handleUnwrap}
            onMove={handleMove}
            onDuplicate={handleDuplicate}
            inPromptScope={selectionInScope}
            onTogglePromptScope={() => {
              if (effectiveKey) {
                handleToggleScope(effectiveKey, selectedChain, false);
              }
            }}
            promptScopeInstanceCount={selectedInstanceCount}
            inPromptScopeTemplate={templateInScope}
            onTogglePromptScopeTemplate={() => {
              if (effectiveKey) {
                handleToggleScope(effectiveKey, null, true);
              }
            }}
          />
        )}

        <HistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          entries={history}
          activeId={activeEntry?.id ?? null}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onClear={handleClear}
          onImportJson={handleImportSpec}
        />
      </div>
    </JSONUIProvider>
  );
}
