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
import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditPanel, PickOverlay } from "@/components/editor";
import { HistoryDrawer } from "@/components/history-drawer";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  promptRevisionLabel,
  propertyRevisionLabel,
  replaceProp,
  scopeInstruction,
} from "@/lib/editor";
import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const pendingOpRef = useRef<PendingOp | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Element keys ([data-jr-key]) only render while devtools are marked
  // active — pick mode needs them for hit-testing and outlines.
  useEffect(() => markDevtoolsActive(), []);

  const activeEntry =
    activeId === null
      ? null
      : (history.find((entry) => entry.id === activeId) ?? null);

  const { spec, isStreaming, error, send, clear } = useUIStream({
    api: "/api/generate",
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

  const displayedSpec = restoredSpec ?? spec;
  // Derived selection: stale keys (removed by a patch/undo) simply read as
  // unselected — no effect round trip needed.
  const effectiveKey =
    selectedKey && displayedSpec?.elements[selectedKey] ? selectedKey : null;
  const selectedElement =
    displayedSpec && effectiveKey
      ? displayedSpec.elements[effectiveKey]
      : undefined;

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
      void send(prompt, { previousSpec: structuredClone(base) });
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
    void send(prompt);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const prompt = formData.get("prompt");
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      handleSend(prompt.trim());
    }
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
    void send(scopeInstruction(selectedKey, element.type, instruction), {
      previousSpec: structuredClone(base),
    });
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
    const left = Math.min(
      Math.max(elementRect.left - containerRect.left, 8),
      Math.max(containerRect.width - PANEL_WIDTH - 8, 8),
    );
    setPanelPos({
      top: elementRect.bottom - containerRect.top + 8,
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("playground.title")}
          </h1>
          <Badge variant="secondary">json-render</Badge>
        </div>
        <p className="text-muted-foreground">{t("playground.subtitle")}</p>
      </header>

      <div className="flex items-center justify-end gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHistoryOpen(true)}
        >
          {t("playground.history")}
          {history.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {history.length}
            </Badge>
          )}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            name="prompt"
            placeholder={t("playground.promptPlaceholder")}
            disabled={isStreaming}
            className="h-9 flex-1"
          />
          <Button type="submit" disabled={isStreaming} className="h-9 px-4">
            {isStreaming
              ? t("playground.generating")
              : displayedSpec
                ? t("playground.steer")
                : t("playground.generate")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLE_PROMPT_LIST.map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              disabled={isStreaming}
              onClick={() => handleGenerate(example)}
            >
              {example}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {displayedSpec && !isStreaming && (
              <Button
                type="button"
                variant={pickMode ? "default" : "outline"}
                size="sm"
                aria-pressed={pickMode}
                onClick={handleTogglePick}
              >
                {t("editor.pick")}
              </Button>
            )}
            {displayedSpec && !isStreaming && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearCurrent}
                className="text-destructive hover:text-destructive"
              >
                {t("playground.clear")}
              </Button>
            )}
          </div>
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("playground.generationFailed")}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Card className="flex-1">
        <CardContent className="flex min-h-40 flex-col">
          <div
            ref={containerRef}
            className={`relative flex min-h-40 flex-1 flex-col ${
              pickMode ? "jr-pick-enabled" : ""
            }`}
          >
            {!displayedSpec && !isStreaming && (
              <p className="text-sm text-muted-foreground">
                {t("playground.emptyState")}
              </p>
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
                  elementKey={effectiveKey}
                  element={selectedElement}
                  position={panelPos}
                  canUndo={activeEntry !== null && canUndo(activeEntry)}
                  canRedo={activeEntry !== null && canRedo(activeEntry)}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onClose={() => setSelectedKey(null)}
                  onPropChange={handlePropChange}
                  onAction={handleAction}
                />
              )}
            <PickOverlay
              enabled={pickMode && !isStreaming && displayedSpec !== null}
              containerRef={containerRef}
              selectedKey={effectiveKey}
              onSelect={setSelectedKey}
            />
          </div>
        </CardContent>
      </Card>

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
