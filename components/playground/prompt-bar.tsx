"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  UIEvent,
} from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { familyFor } from "@/components/editor/type-families";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  findActiveMention,
  insertMention,
  type ActiveMention,
} from "@/lib/playground/mention-token";

/** One removable prompt-scope chip rendered above the input. */
export interface PromptScopeChip {
  id: string;
  /** Element key — `@`-autocomplete source and mirror-token matcher. */
  key: string;
  /** Element type — drives the x-ray family colors. */
  type: string;
  /** Display label, e.g. `product-card · Card 2/8`. */
  label: string;
  /**
   * Resolved instance snippet (e.g. the bound product name) — shown in the
   * `@`-autocomplete option so two instances of the same key are
   * distinguishable; null/omitted for template chips.
   */
  detail?: string | null;
  /**
   * 1-based repeat instance index for instance-scoped chips; null/omitted
   * for templates. Flows into the token body (`key#N`) so two instances of
   * the same key produce distinct, model-attributable mentions.
   */
  instanceIndex?: number | null;
}

/** Token body for a chip: `key` for templates, `key#N` for instances. */
function chipTokenBody(chip: PromptScopeChip): string {
  return chip.instanceIndex != null
    ? `${chip.key}#${chip.instanceIndex}`
    : chip.key;
}

/** Split an autocomplete query on `#` — key prefix + optional instance filter. */
function parseMentionQuery(query: string): {
  keyPrefix: string;
  instanceIndex: string | null;
} {
  const hash = query.indexOf("#");
  if (hash === -1) return { keyPrefix: query, instanceIndex: null };
  return {
    keyPrefix: query.slice(0, hash),
    instanceIndex: query.slice(hash + 1),
  };
}

interface PromptBarProps {
  isStreaming: boolean;
  hasSpec: boolean;
  onSend: (prompt: string) => void;
  /** Prompt-scope chips; empty/omitted hides the chip row. */
  scope?: readonly PromptScopeChip[];
  onRemoveScope?: (id: string) => void;
}

/** Text metrics shared by the textarea and its mirror — any divergence
 *  visibly doubles the text (mirror chars sit next to textarea chars). */
const FIELD_TEXT =
  "px-2.5 py-2 text-base leading-6 md:text-sm whitespace-pre-wrap break-words";

export function PromptBar({
  isStreaming,
  hasSpec,
  onSend,
  scope,
  onRemoveScope,
}: PromptBarProps) {
  const t = useTranslations();
  const chips = scope ?? [];

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState("");
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Caret position of a just-inserted `@key` token — the token still looks
  // "active" to the detector, but the picker must stay closed until the
  // caret moves or the text changes (otherwise Enter re-opens it and can
  // never reach the submit handler).
  const [mutedUntil, setMutedUntil] = useState<number | null>(null);
  // Last detected query — refreshMention runs on every keyup/select, and the
  // highlight must only reset when the token's text actually changed (arrow
  // navigation would otherwise bounce back to option 0 on every keyup).
  const lastQueryRef = useRef<string | null>(null);

  const refreshMention = (text: string, caret: number) => {
    if (mutedUntil !== null) {
      if (caret === mutedUntil) {
        lastQueryRef.current = null;
        setMention(null);
        return;
      }
      setMutedUntil(null);
    }
    const active = findActiveMention(text, caret);
    if (!active) {
      lastQueryRef.current = null;
      setMention(null);
      return;
    }
    const matches = matchChips(active.query);
    const queryChanged = lastQueryRef.current !== active.query;
    lastQueryRef.current = active.query;
    setMention(matches.length > 0 ? active : null);
    if (queryChanged) {
      setMentionIndex(0);
    } else {
      // Same token: clamp only, so ↑/↓ selection survives refreshes.
      setMentionIndex((index) =>
        Math.min(index, Math.max(matches.length - 1, 0)),
      );
    }
  };

  const mentionMatches = mention ? matchChips(mention.query) : [];

  function matchChips(query: string): PromptScopeChip[] {
    const { keyPrefix, instanceIndex } = parseMentionQuery(query);
    const prefix = keyPrefix.toLowerCase();
    return chips.filter((chip) => {
      if (!chip.key.toLowerCase().startsWith(prefix)) return false;
      if (instanceIndex === null || instanceIndex === "") return true;
      return String(chip.instanceIndex ?? "") === instanceIndex;
    });
  }

  const pickMention = (chip: PromptScopeChip) => {
    if (!mention) return;
    const next = insertMention(value, mention, chipTokenBody(chip));
    lastQueryRef.current = null;
    setValue(next.text);
    setMention(null);
    setMutedUntil(next.caret);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  // Auto-grow: reset then measure so shrinking works too. The max-h +
  // overflow-y-auto pair clamps the growth to ~8 lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, chips.length]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim().length > 0) {
      onSend(value.trim());
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (index) =>
            (index - 1 + mentionMatches.length) % mentionMatches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMention(mentionMatches[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        lastQueryRef.current = null;
        setMention(null);
        return;
      }
    }
    // Enter submits; Shift+Enter is the newline. IME composition Enter must
    // insert, never submit.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  // Mirror: render the text with scoped tokens as family-colored chip spans.
  // Decoration is background + outline only — border/padding/font changes
  // would shift the mirror's character grid out of alignment with the
  // textarea's. Instance tokens carry `#N`, so the map is keyed by the full
  // token body — two instances of one key stay separate spans.
  const mirrorNodes: ReactNode[] = [];
  if (value.length > 0) {
    const scoped = new Map(
      chips.map((chip) => [`@${chipTokenBody(chip)}`, chip]),
    );
    const TOKEN = /@[\w#-]+/g;
    let cursor = 0;
    for (const match of value.matchAll(TOKEN)) {
      const token = match[0];
      const start = match.index;
      const chip = scoped.get(token);
      if (chip === undefined) continue;
      if (start > cursor) mirrorNodes.push(value.slice(cursor, start));
      mirrorNodes.push(
        <span
          key={start}
          data-mention-chip={chipTokenBody(chip)}
          className={`rounded-[3px] bg-zinc-400/20 outline outline-1 -outline-offset-1 ${familyFor(chip.type).outline}`}
        >
          {token}
        </span>,
      );
      cursor = start + token.length;
    }
    if (cursor < value.length) mirrorNodes.push(value.slice(cursor));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute bottom-6 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4"
    >
      {chips.length > 0 && (
        <div
          data-testid="prompt-scope"
          className="mb-2 flex flex-wrap items-center gap-1.5"
        >
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-label={t("playground.scopeRemove", { label: chip.label })}
              disabled={isStreaming}
              onClick={() => onRemoveScope?.(chip.id)}
              data-testid={`prompt-scope-chip-${chip.key}`}
              className={`inline-flex max-w-[200px] cursor-pointer items-center gap-1 truncate rounded-md border bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm disabled:pointer-events-none disabled:opacity-40 ${familyFor(chip.type).chip}`}
            >
              <span className="truncate">{chip.label}</span>
              <X className="h-2.5 w-2.5 shrink-0" />
            </button>
          ))}
        </div>
      )}
      <div className="relative rounded-2xl border bg-background/80 p-2 pl-4 shadow-lg backdrop-blur-md">
        <div className="relative flex items-end gap-2">
          <div className="relative min-h-9 w-full min-w-0 flex-1">
            {mention && mentionMatches.length > 0 && (
              <ul
                role="listbox"
                aria-label={t("playground.mentionList")}
                data-testid="mention-list"
                className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
              >
                {mentionMatches.map((chip, index) => {
                  // Labels are `{key} · {type} …` — show everything after the
                  // key so instance options carry their index/count.
                  const suffix = chip.label.startsWith(chip.key)
                    ? chip.label.slice(chip.key.length).trim()
                    : chip.label;
                  const tokenBody = chipTokenBody(chip);
                  return (
                    <li key={chip.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === mentionIndex}
                        data-testid={`mention-option-${tokenBody}`}
                        // mousedown (not click) so the textarea never blurs and
                        // loses the caret before the pick lands
                        onMouseDown={(event) => {
                          event.preventDefault();
                          pickMention(chip);
                        }}
                        className={`flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm ${
                          index === mentionIndex ? "bg-accent" : ""
                        }`}
                      >
                        <span
                          data-testid={`mention-option-chip-${tokenBody}`}
                          className={`truncate rounded-md border bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 ${familyFor(chip.type).chip}`}
                        >
                          {chip.key}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {suffix}
                        </span>
                        {chip.detail && (
                          <span className="truncate text-muted-foreground/80">
                            · {chip.detail}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
            >
              <div
                ref={mirrorRef}
                data-testid="prompt-mirror"
                className={`text-foreground ${FIELD_TEXT}`}
                style={{ minHeight: "100%" }}
              >
                {mirrorNodes}
                {"\n"}
              </div>
            </div>
            <Textarea
              ref={textareaRef}
              name="prompt"
              data-testid="prompt-input"
              value={value}
              placeholder={t("playground.promptPlaceholder")}
              disabled={isStreaming}
              rows={1}
              onChange={(event) => {
                setValue(event.target.value);
                refreshMention(event.target.value, event.target.selectionStart);
              }}
              onSelect={(event) => {
                refreshMention(value, event.currentTarget.selectionStart);
              }}
              onKeyUp={(event) => {
                // Enter is fully handled in keydown (pick or submit); a
                // keyup refresh could re-open a just-inserted token against
                // a stale caret.
                if (event.key !== "Enter") {
                  refreshMention(value, event.currentTarget.selectionStart);
                }
              }}
              onBlur={() => setMention(null)}
              onKeyDown={handleKeyDown}
              onScroll={handleScroll}
              className={`relative field-sizing-none min-h-9 max-h-32 w-full resize-none overflow-y-auto border-0 bg-transparent shadow-none text-transparent [caret-color:var(--foreground)] focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:disabled:bg-transparent ${FIELD_TEXT}`}
            />
          </div>
          <Button
            type="submit"
            disabled={isStreaming}
            className="h-9 shrink-0 px-4"
          >
            {isStreaming
              ? t("playground.generating")
              : hasSpec
                ? t("playground.steer")
                : t("playground.generate")}
          </Button>
        </div>
      </div>
    </form>
  );
}
