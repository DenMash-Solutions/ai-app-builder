"use client";

import type { Spec } from "@json-render/core";
import { markDevtoolsActive } from "@json-render/core";
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
  EditPanel,
  HoverBadge,
  PickOverlay,
  PANEL_TABS,
  type PanelTab,
} from "@/components/editor";
import { HistoryDrawer } from "@/components/history-drawer";
import { PromptBar, ToolRail, TopBar } from "@/components/playground";
import { QuotaDialog } from "@/components/quota-dialog";
import {
  STRUCTURE_OPS,
  duplicateElement,
  findParentKey,
  getAncestorPath,
  insertElement,
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
import type { MoveDirection } from "@/lib/editor";
import { examplePropsFor } from "@/lib/playground/catalog";
import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";
import { getModel, setModel } from "@/lib/playground/model-store";
import { RATE_LIMIT_PATTERN, type ModelId } from "@/lib/playground/models";
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
import { registry } from "@/lib/playground/registry";

const EXAMPLE_PROMPT_LIST = Object.values(EXAMPLE_PROMPTS);

const PANEL_WIDTH = 320;

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
  const [xrayMode, setXrayMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>(PANEL_TABS.properties);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const pendingOpRef = useRef<PendingOp | null>(null);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const quotaMessageRef = useRef("");
  const lastRequestRef = useRef<{
    prompt: string;
    context: Record<string, unknown>;
  } | null>(null);
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
      if (RATE_LIMIT_PATTERN.test(streamError.message)) {
        quotaMessageRef.current = streamError.message;
        setQuotaOpen(true);
        return;
      }
      toast.error(t("playground.generationFailed"), {
        description: streamError.message,
      });
    },
    onComplete: (completedSpec) => {
      const op = pendingOpRef.current;
      pendingOpRef.current = null;
      if (!op) return;

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

  // Every request records its payload so a quota-dialog retry can replay it
  // with the newly selected model (pendingOpRef still holds the operation).
  const sendNow = (
    prompt: string,
    context: Record<string, unknown> = {},
  ): void => {
    lastRequestRef.current = { prompt, context };
    void send(prompt, { ...context, model: getModel() });
  };

  const displayedSpec = restoredSpec ?? spec;
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
    setActiveId(null);
    sendNow(prompt);
  };

  const handleSelect = (entry: HistoryEntry) => {
    setRestoredSpec(entry.spec);
    setActiveId(entry.id);
    setSelectedKey(null);
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
    setSelectedKey(null);
  };

  const handleTogglePick = () => {
    if (pickMode) setSelectedKey(null);
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
    sendNow(scopeInstruction(selectedKey, element.type, instruction), {
      previousSpec: structuredClone(base),
    });
  };

  const handleQuotaConfirm = (model: ModelId) => {
    setModel(model);
    setQuotaOpen(false);
    const last = lastRequestRef.current;
    if (last) sendNow(last.prompt, last.context);
  };

  // Dismissing without retrying surfaces the original failure as a toast.
  const handleQuotaOpenChange = (open: boolean) => {
    if (!open) {
      toast.error(t("playground.generationFailed"), {
        description: quotaMessageRef.current,
      });
    }
    setQuotaOpen(open);
  };

  const handlePropChange = (prop: string, value: unknown) => {
    if (!displayedSpec || !selectedKey || !activeId || isStreaming) return;
    const entry = history.find((candidate) => candidate.id === activeId);
    if (!entry) return;
    const next = replaceProp(displayedSpec, selectedKey, prop, value);
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

  const updatePanelPos = useCallback(() => {
    const container = containerRef.current;
    if (!container || !effectiveKey) {
      setPanelPos(null);
      return;
    }
    const tagged = container.querySelector<HTMLElement>(
      `[data-jr-key="${effectiveKey}"]`,
    );
    // The tag itself is display:contents (no box) — measure its element child.
    const element = tagged?.firstElementChild ?? tagged;
    if (!element) {
      setPanelPos(null);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const scrollTop = container.scrollTop;
    const left = Math.min(
      Math.max(elementRect.left - containerRect.left + container.scrollLeft, 8),
      Math.max(container.scrollWidth - PANEL_WIDTH - 8, 8),
    );
    setPanelPos({
      top: elementRect.bottom - containerRect.top + scrollTop + 8,
      left,
    });
  }, [effectiveKey]);

  useEffect(() => {
    updatePanelPos();
  }, [updatePanelPos, displayedSpec]);

  useEffect(() => {
    window.addEventListener("resize", updatePanelPos);
    return () => window.removeEventListener("resize", updatePanelPos);
  }, [updatePanelPos]);

  // X-ray: tag container wrappers (children or slots) with a data attribute
  // the CSS in globals.css can target — keeps React out of the outline loop.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wrappers = container.querySelectorAll<HTMLElement>("[data-jr-key]");
    if (!xrayMode || !displayedSpec) {
      wrappers.forEach((wrapper) =>
        wrapper.removeAttribute("data-jr-container"),
      );
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
    <main className="dot-grid relative h-[100dvh] w-full overflow-hidden">
      <TopBar
        historyCount={history.length}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {displayedSpec && !isStreaming && (
        <ToolRail
          pickMode={pickMode}
          xrayMode={xrayMode}
          onTogglePick={handleTogglePick}
          onToggleXray={() => setXrayMode((prev) => !prev)}
          onClear={handleClearCurrent}
        />
      )}

      <div
        ref={containerRef}
        className={`absolute inset-0 overflow-y-auto ${
          pickMode ? "jr-pick-enabled" : ""
        } ${xrayMode ? "jr-xray" : ""}`}
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
            spec={displayedSpec}
            registry={registry}
            loading={isStreaming}
          />
          {displayedSpec &&
            !isStreaming &&
            pickMode &&
            effectiveKey &&
            selectedElement &&
            panelPos && (
              <EditPanel
                key={effectiveKey}
                spec={displayedSpec}
                elementKey={effectiveKey}
                element={selectedElement}
                ancestors={ancestors}
                position={panelPos}
                tab={panelTab}
                onTabChange={setPanelTab}
                canUndo={activeEntry !== null && canUndo(activeEntry)}
                canRedo={activeEntry !== null && canRedo(activeEntry)}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onClose={() => setSelectedKey(null)}
                onSelectKey={setSelectedKey}
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
          <PickOverlay
            enabled={pickMode && !isStreaming && displayedSpec !== null}
            containerRef={containerRef}
            selectedKey={effectiveKey}
            onSelect={setSelectedKey}
          />
          <HoverBadge
            enabled={pickMode && !isStreaming && displayedSpec !== null}
            containerRef={containerRef}
            spec={displayedSpec}
          />
        </div>
      </div>

      {quotaOpen && (
        <QuotaDialog
          onOpenChange={handleQuotaOpenChange}
          onConfirm={handleQuotaConfirm}
        />
      )}

      <PromptBar
        isStreaming={isStreaming}
        hasSpec={displayedSpec !== null}
        onSend={handleSend}
      />

      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entries={history}
        activeId={activeId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onClear={handleClear}
      />
    </main>
  );
}

export default function Home() {
  return (
    <StateProvider initialState={{}}>
      <VisibilityProvider>
        <ActionProvider handlers={{}}>
          <ValidationProvider customFunctions={{}}>
            <Playground />
          </ValidationProvider>
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
