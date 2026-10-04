"use client";

import type { Spec } from "@json-render/core";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  ValidationProvider,
  VisibilityProvider,
  useUIStream,
} from "@json-render/react";
import { useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HistoryDrawer } from "@/components/history-drawer";
import type { HistoryEntry } from "@/lib/history";
import {
  addEntry,
  clearHistory,
  createEntry,
  getHistory,
  getServerHistory,
  removeEntry,
  subscribeHistory,
} from "@/lib/history";
import { registry } from "@/lib/registry";

const EXAMPLE_PROMPTS = [
  "Revenue dashboard with 4 KPI metrics",
  "Sign-in form with email and password",
  "Pricing comparison of three plans",
  "Crea una página en español con 2 secciones (Hero y Servicios) para una clínica dental. En el hero se debe mostrar una imagen",
];

function Playground() {
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistory,
    getServerHistory,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoredSpec, setRestoredSpec] = useState<Spec | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);

  const { spec, isStreaming, error, send, clear } = useUIStream({
    api: "/api/generate",
    onComplete: (completedSpec) => {
      const prompt = pendingPromptRef.current;
      pendingPromptRef.current = null;
      if (!prompt) return;
      const entry = createEntry(prompt, completedSpec);
      addEntry(entry);
      setActiveId(entry.id);
    },
  });

  const handleSend = (prompt: string) => {
    pendingPromptRef.current = prompt;
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
  };

  const displayedSpec = restoredSpec ?? spec;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            GenUI Playground
          </h1>
          <Badge variant="secondary">json-render</Badge>
        </div>
        <p className="text-muted-foreground">
          Describe an interface — the model streams a JSONL spec that renders
          with the shadcn catalog.
        </p>
      </header>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setHistoryOpen(true)}
        >
          History
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
            placeholder="Describe the UI you want…"
            disabled={isStreaming}
            className="h-9 flex-1"
          />
          <Button type="submit" disabled={isStreaming} className="h-9 px-4">
            {isStreaming ? "Generating…" : "Generate"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {EXAMPLE_PROMPTS.map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              disabled={isStreaming}
              onClick={() => handleSend(example)}
            >
              {example}
            </Button>
          ))}
          {displayedSpec && !isStreaming && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearCurrent}
              className="ml-auto text-destructive hover:text-destructive"
            >
              Clear
            </Button>
          )}
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Generation failed</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <Card className="flex-1">
        <CardContent className="flex min-h-40 flex-col">
          {!displayedSpec && !isStreaming && (
            <p className="text-sm text-muted-foreground">
              The generated UI will render here.
            </p>
          )}
          <Renderer
            spec={displayedSpec}
            registry={registry}
            loading={isStreaming}
          />
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
