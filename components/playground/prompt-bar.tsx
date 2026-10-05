"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PromptBarProps {
  isStreaming: boolean;
  hasSpec: boolean;
  onSend: (prompt: string) => void;
}

export function PromptBar({ isStreaming, hasSpec, onSend }: PromptBarProps) {
  const t = useTranslations();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = new FormData(event.currentTarget).get("prompt");
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      onSend(prompt.trim());
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute bottom-6 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4"
    >
      <div className="flex items-center gap-2 rounded-2xl border bg-background/80 p-2 pl-4 shadow-lg backdrop-blur-md">
        <Input
          name="prompt"
          placeholder={t("playground.promptPlaceholder")}
          disabled={isStreaming}
          className="h-9 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" disabled={isStreaming} className="h-9 px-4">
          {isStreaming
            ? t("playground.generating")
            : hasSpec
              ? t("playground.steer")
              : t("playground.generate")}
        </Button>
      </div>
    </form>
  );
}
