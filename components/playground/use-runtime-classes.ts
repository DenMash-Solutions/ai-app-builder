"use client";

import { useEffect } from "react";
import type { Spec } from "@json-render/core";
import { collectSpecClassTokens } from "@/lib/runtime-classes/candidates";
import { reportMissing } from "@/lib/runtime-classes/missing";

const STYLE_ID = "runtime-tailwind-css";
const DEBOUNCE_MS = 200;

/** Tokens already requested this session (compiled or reported missing). */
const requested = new Set<string>();

function ensureStyleElement(): HTMLStyleElement {
  let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ID;
    document.head.appendChild(element);
  }
  return element;
}

async function requestMissingClasses(spec: Spec): Promise<void> {
  const tokens = collectSpecClassTokens(spec);
  const pending = tokens.filter((token) => !requested.has(token));
  if (pending.length === 0) return;
  for (const token of pending) requested.add(token);
  try {
    const response = await fetch("/api/tailwind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: pending }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      css?: unknown;
      missing?: unknown;
    };
    if (typeof data.css !== "string" || !Array.isArray(data.missing)) {
      throw new Error("Unexpected /api/tailwind payload");
    }
    if (data.css !== "") {
      ensureStyleElement().appendChild(document.createTextNode(data.css));
    }
    reportMissing(
      data.missing.filter(
        (token): token is string => typeof token === "string",
      ),
    );
  } catch (error) {
    // Static CSS stays in place — runtime compile is an enhancement.
    console.warn("[runtime-classes] /api/tailwind request failed:", error);
    for (const token of pending) requested.delete(token);
  }
}

/**
 * Keeps the document's compiled CSS in step with the rendered spec: collects
 * every className token and asks /api/tailwind for the ones not requested yet,
 * injecting the returned CSS. Debounced (200ms) per spec identity.
 */
export function useRuntimeClasses(spec: Spec | null | undefined): void {
  useEffect(() => {
    if (!spec) return;
    const timer = setTimeout(() => {
      void requestMissingClasses(spec);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [spec]);
}
