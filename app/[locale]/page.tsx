"use client";

import type { Spec } from "@json-render/core";
import {
  isNonEmptySpec,
  markDevtoolsActive,
  setByPath,
} from "@json-render/core";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  useUIStream,
} from "@json-render/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
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
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { FailureDialog } from "@/components/failure-dialog";
import {
  STRUCTURE_OPS,
  chainForKey,
  duplicateElement,
  findParentKey,
  getAncestorPath,
  insertElement,
  moveElement,
  moveSibling,
  promptRevisionLabel,
  propertyRevisionLabel,
  removeElement,
  replaceProp,
  scopeInstruction,
  structureRevisionLabel,
  unwrapElement,
  wrapElement,
} from "@/lib/editor";
import type { InstanceChain, MoveDirection } from "@/lib/editor";
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
import { specsEqual } from "@/lib/utils";
import { registry } from "@/lib/playground/registry";
import { fixupScrollLayout } from "@/lib/playground/scroll-layout-fixup";

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

function Playground() {
  const t = useTranslations();
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistory,
    getServerHistory,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoredSpec, setRestoredSpec] = useState<Spec | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [dndMode, setDndMode] = useState(false);
  const [xrayMode, setXrayMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<InstanceChain | null>(
    null,
  );
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

  const activeEntry =
    activeId === null
      ? null
      : (history.find((entry) => entry.id === activeId) ?? null);

  const { spec, isStreaming, send, clear } = useUIStream({
    api: "/api/generate",
    onError: (streamError) => {
      // A failed fresh generation leaves the hook's empty spec mounted, which
      // hides the empty state — restore it. Failed edits keep their spec.
      if (!lastRequestRef.current?.context.previousSpec) clear();
      const message = streamError.message;
      if (RATE_LIMIT_PATTERN.test(message)) {
        setFailure({ kind: "quota", message });
        return;
      }
      if (SERVICE_UNAVAILABLE_PATTERN.test(message)) {
        setFailure({ kind: "service", message });
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
        setFailure({ kind: "service", message: t("service.noChanges") });
        return;
      }
      pendingOpRef.current = null;

      if (op.kind === PENDING_OP_KINDS.generate) {
        const entry = createEntry(op.prompt, completedSpec);
        addEntry(entry);
        setActiveId(entry.id);
        return;
      }

      const entry = getHistory().find(
        (candidate) => candidate.id === op.entryId,
      );
      if (!entry) return;
      const updated = commitRevision(entry, completedSpec, op.label);
      updateEntry(updated);
      setActiveId(updated.id);
      setRestoredSpec(completedSpec);
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
    void send(prompt, { ...context, model: getModel() });
  };

  const displayedSpec = restoredSpec ?? spec;
  // Runtime classes: spec classNames exist only at runtime — compile any not
  // yet covered via /api/tailwind and inject the CSS (no-op on failure).
  useRuntimeClasses(displayedSpec);
  // Derived render copy: carousels get scroll-container classes and
  // width-definite ancestors (see scroll-layout-fixup) without mutating what
  // the model produced or what editing/history operate on.
  const renderSpec = displayedSpec ? fixupScrollLayout(displayedSpec) : null;
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
          spec: displayedSpec,
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

  const handleSelectKey = (key: string) => {
    setPanelClosing(false);
    setSelectedKey(key);
    setSelectedChain((chain) =>
      displayedSpec && chain ? chainForKey(displayedSpec, chain, key) : null,
    );
  };

  // Main input: edits the displayed result (steer), generates when empty.
  const handleSend = (prompt: string) => {
    const base = displayedSpec;
    if (base?.root && activeId) {
      pendingOpRef.current = {
        kind: PENDING_OP_KINDS.edit,
        entryId: activeId,
        label: promptRevisionLabel(prompt),
      };
      setRestoredSpec(null);
      steerBaselineRef.current = structuredClone(base);
      sendNow(prompt, { previousSpec: structuredClone(base) });
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
    setRestoredSpec(null);
    steerBaselineRef.current = null;
    setActiveId(null);
    sendNow(prompt);
  };

  const handleSelect = (entry: HistoryEntry) => {
    setRestoredSpec(entry.spec);
    setActiveId(entry.id);
    clearSelection();
    setHistoryOpen(false);
  };

  // Imported JSON becomes its own history entry (steer/pick/edits all
  // require an active entry), then activates like a history selection.
  // The import lives in the history drawer, which closes once the spec
  // is on canvas.
  const handleImportSpec = (importedSpec: Spec) => {
    const entry = createEntry(t("playground.importedEntry"), importedSpec);
    addEntry(entry);
    setRestoredSpec(entry.spec);
    setActiveId(entry.id);
    clearSelection();
    setHistoryOpen(false);
  };

  const handleDelete = (id: string) => {
    removeEntry(id);
    if (activeId === id) {
      setActiveId(null);
      setRestoredSpec(null);
    }
  };

  const handleClear = () => {
    clearHistory();
    setActiveId(null);
    setRestoredSpec(null);
  };

  const handleClearCurrent = () => {
    clear();
    setRestoredSpec(null);
    setActiveId(null);
    clearSelection();
  };

  const handleTogglePick = () => {
    if (pickMode) beginPanelClose();
    setPickMode(!pickMode);
  };

  const handleAction = (instruction: string, label: string) => {
    const base = displayedSpec;
    if (!base?.root || !selectedKey || !activeId || isStreaming) return;
    const element = base.elements[selectedKey];
    if (!element) return;
    pendingOpRef.current = {
      kind: PENDING_OP_KINDS.edit,
      entryId: activeId,
      label,
    };
    setRestoredSpec(null);
    steerBaselineRef.current = structuredClone(base);
    sendNow(scopeInstruction(selectedKey, element.type, instruction), {
      previousSpec: structuredClone(base),
    });
  };

  const handleFailureConfirm = (model: ModelId) => {
    setModel(model);
    setFailure(null);
    const last = lastRequestRef.current;
    if (last) sendNow(last.prompt, last.context);
  };

  // Dismissing without retrying surfaces the original failure as a toast.
  const handleFailureOpenChange = (open: boolean) => {
    if (!open) {
      toast.error(t("playground.generationFailed"), {
        description: failure?.message ?? "",
      });
      setFailure(null);
    }
  };

  const handlePropChange = (
    prop: string,
    value: unknown,
    dataPath: string | null,
  ) => {
    if (!displayedSpec || !selectedKey || !activeId || isStreaming) return;
    const entry = history.find((candidate) => candidate.id === activeId);
    if (!entry) return;
    let next: Spec;
    if (dataPath !== null) {
      // Data-bound prop: write the instance's state path — the template prop
      // keeps its expression and other items stay untouched.
      next = structuredClone(displayedSpec);
      next.state = next.state ?? {};
      setByPath(next.state, dataPath, value);
    } else {
      next = replaceProp(displayedSpec, selectedKey, prop, value);
    }
    const updated = commitRevision(entry, next, propertyRevisionLabel(prop));
    updateEntry(updated);
    setActiveId(updated.id);
    setRestoredSpec(next);
  };

  // Structural edits are local deterministic ops — same commit path as prop
  // edits (undoable revisions), with an explicit selection target so focus
  // follows the operation (insert→new, remove→parent, move→stay).
  const commitStructure = (
    next: Spec | null,
    label: string,
    selectKey?: string | null,
  ): void => {
    if (!next || !activeId) return;
    const entry = history.find((candidate) => candidate.id === activeId);
    if (!entry) return;
    const updated = commitRevision(entry, next, label);
    updateEntry(updated);
    setActiveId(updated.id);
    setRestoredSpec(next);
    // Structure ops shift instance positions — drop the chain so the panel
    // falls back to safe template-level editing instead of a stale index.
    setSelectedChain(null);
    if (selectKey !== undefined) setSelectedKey(selectKey);
  };

  const handleInsert = (parentKey: string, type: string) => {
    if (!displayedSpec || !activeId || isStreaming) return;
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
    if (!displayedSpec || !activeId || isStreaming) return;
    commitStructure(
      removeElement(displayedSpec, key),
      structureRevisionLabel(STRUCTURE_OPS.remove),
      findParentKey(displayedSpec, key),
    );
  };

  const handleGroup = (key: string, containerType: string) => {
    if (!displayedSpec || !activeId || isStreaming) return;
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
    if (!displayedSpec || !activeId || isStreaming) return;
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
    if (!displayedSpec || !activeId || isStreaming) return;
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
    if (!displayedSpec || !activeId || isStreaming) return;
    commitStructure(
      moveElement(displayedSpec, { key, targetParentKey, index }),
      structureRevisionLabel(STRUCTURE_OPS.move),
    );
  };

  const handleDuplicate = (key: string) => {
    if (!displayedSpec || !activeId || isStreaming) return;
    const result = duplicateElement(displayedSpec, key);
    commitStructure(
      result?.spec ?? null,
      structureRevisionLabel(STRUCTURE_OPS.duplicate),
      result?.key,
    );
  };

  const applyRevision = useCallback((entry: HistoryEntry) => {
    updateEntry(entry);
    setActiveId(entry.id);
    setRestoredSpec(entry.spec);
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

  // Cmd+Z / Cmd+Shift+Z — scoped to the canvas, never inside form fields.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!activeEntry || isStreaming) return;
      event.preventDefault();
      if (event.shiftKey) {
        if (canRedo(activeEntry)) applyRevision(redoRevision(activeEntry));
      } else if (canUndo(activeEntry)) {
        applyRevision(undoRevision(activeEntry));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeEntry, applyRevision, isStreaming]);

  return (
    <StateProvider initialState={displayedSpec?.state ?? {}}>
      <VisibilityProvider>
        <ActionProvider handlers={{}}>
          <ValidationProvider customFunctions={{}}>
            <main className="dot-grid relative flex h-[100dvh] w-full flex-col overflow-hidden md:flex-row">
              {/* Stage: holds all chrome and the canvas; shrinks when the
                  edit panel docks (right on desktop, bottom on mobile) so the
                  rail, prompt bar, and top bar are never covered. */}
              <div className="relative min-h-0 min-w-0 flex-1">
                <TopBar
                  historyCount={history.length}
                  onOpenHistory={() => setHistoryOpen(true)}
                />

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
                      enabled={
                        dndMode && displayedSpec !== null && !isStreaming
                      }
                      containerRef={containerRef}
                      spec={displayedSpec}
                      onMoveTo={handleMoveTo}
                    />
                    <HoverBadge
                      enabled={
                        pickMode && !isStreaming && displayedSpec !== null
                      }
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
                />
                <PickOverlay
                  enabled={pickMode && !isStreaming && displayedSpec !== null}
                  containerRef={containerRef}
                  spec={displayedSpec}
                  selectedKey={effectiveKey}
                  selectedChain={selectedChain}
                  onSelect={handlePick}
                />

                {failure && (
                  <FailureDialog
                    kind={failure.kind}
                    onOpenChange={handleFailureOpenChange}
                    onConfirm={handleFailureConfirm}
                  />
                )}

                <PromptBar
                  isStreaming={isStreaming}
                  hasSpec={displayedSpec !== null}
                  onSend={handleSend}
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
                />
              )}

              <HistoryDrawer
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                entries={history}
                activeId={activeId}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onClear={handleClear}
                onImportJson={handleImportSpec}
              />
            </main>
          </ValidationProvider>
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}

export default function Home() {
  return <Playground />;
}
