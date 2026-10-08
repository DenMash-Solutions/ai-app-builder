/**
 * Cross-model capture for the scrollable-carousel feature: POSTs the exact
 * example-chip prompt to /api/generate for each model, saves the raw JSONL
 * stream, folds it into the final spec the client would render (the same
 * parseSpecStreamLine + applySpecPatch sequence useUIStream applies), and
 * writes a static analysis JSON beside each raw response.
 *
 * Run: bun docs/plan/scrollable-carousel/responses/capture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySpecPatch,
  parseSpecStreamLine,
  type Spec,
  type UIElement,
} from "@json-render/core";
import { EXAMPLE_PROMPTS } from "@/lib/playground/example-prompts";

const PROMPT = EXAMPLE_PROMPTS.carousel8;
const API = "http://localhost:3000/api/generate";
const TIMEOUT_MS = 180_000;

const MODELS = [
  { id: "gemini-3.8-flash", slug: "gemini-3.8-flash" },
  { id: "gemini-3.7-flash", slug: "gemini-3.7-flash" },
  { id: "gemini-3.6-flash", slug: "gemini-3.6-flash" },
  { id: "gemini-3.5-flash", slug: "gemini-3.5-flash" },
  { id: "gemini-3.5-flash-lite", slug: "gemini-3.5-flash-lite" },
  // Substitutes for models that fail to respond (3.7 timed out repeatedly;
  // 3-flash and 2.5-flash returned empty-completion 503s).
  { id: "gemini-3.1-flash-lite", slug: "gemini-3.1-flash-lite" },
  { id: "gemini-3-flash", slug: "gemini-3-flash" },
  { id: "gemini-2.5-flash", slug: "gemini-2.5-flash" },
] as const;

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface FoldResult {
  spec: Spec;
  lines: number;
  patches: number;
  invalidLines: number;
  usage: Usage | null;
}

function fold(raw: string): FoldResult {
  let spec: Spec = { root: "", elements: {} };
  let lines = 0;
  let patches = 0;
  let invalidLines = 0;
  let usage: Usage | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lines += 1;
    const patch = parseSpecStreamLine(trimmed);
    if (patch) {
      spec = applySpecPatch(spec, patch);
      patches += 1;
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { __meta?: unknown }).__meta === "usage"
      ) {
        const u = parsed as Partial<Usage>;
        usage = {
          promptTokens: u.promptTokens ?? 0,
          completionTokens: u.completionTokens ?? 0,
          totalTokens: u.totalTokens ?? 0,
        };
        continue;
      }
    } catch {
      // fall through — counts as an invalid line, same as the client skips it
    }
    invalidLines += 1;
  }

  return { spec, lines, patches, invalidLines, usage };
}

interface Analysis {
  model: string;
  ok: boolean;
  httpStatus: number;
  error?: string;
  code?: string;
  bytes: number;
  lines: number;
  patches: number;
  invalidLines: number;
  usage: Usage | null;
  root: string;
  elementCount: number;
  stateKeys: string[];
  productsCount: number | null;
  repeats: { key: string; statePath: string }[];
  scrollContainers: {
    key: string;
    className: string;
    hasFlexWrap: boolean;
    hasFlexNowrap: boolean;
    overflowX: string;
    snapType: string;
    gridFlowCol: boolean;
    childKeys: string[];
    childShrinkZero: string;
    childMinWidths: string;
  }[];
  flexWrapElements: string[];
  minWidthNamed: string[];
  minWidthArbitrary: string[];
  maxWidthArbitrary: string[];
}

function classNameOf(element: UIElement | undefined): string {
  const className = element?.props?.["className"];
  return typeof className === "string" ? className : "";
}

function pick(regex: RegExp, className: string): string {
  return className.match(regex)?.[0] ?? "";
}

function analyze(model: string, raw: string, foldResult: FoldResult): Analysis {
  const { spec, lines, patches, invalidLines, usage } = foldResult;
  const elements = spec.elements ?? {};

  const repeats: Analysis["repeats"] = [];
  const flexWrapElements: string[] = [];
  const minWidthNamed: string[] = [];
  const minWidthArbitrary: string[] = [];
  const maxWidthArbitrary: string[] = [];

  for (const [key, element] of Object.entries(elements)) {
    if (element.repeat) {
      repeats.push({
        key,
        statePath: String(element.repeat.statePath ?? ""),
      });
    }
    const className = classNameOf(element);
    if (/\bflex-wrap\b/.test(className)) flexWrapElements.push(key);
    for (const match of className.matchAll(/\bmin-w-(\[[^\]]+\]|[0-9a-z]+)/g)) {
      const value = match[1];
      if (value.startsWith("[")) minWidthArbitrary.push(`${key}:${value}`);
      else minWidthNamed.push(`${key}:${value}`);
    }
    for (const match of className.matchAll(/\bmax-w-(\[[^\]]+\])/g)) {
      maxWidthArbitrary.push(`${key}:${match[1]}`);
    }
  }

  const scrollContainers: Analysis["scrollContainers"] = [];
  for (const [key, element] of Object.entries(elements)) {
    const className = classNameOf(element);
    const overflowX = pick(/\boverflow-x-(?:auto|scroll)\b/, className);
    if (!overflowX) continue;
    const childKeys = (element.children ?? []).filter(
      (child): child is string => typeof child === "string",
    );
    const childClasses = childKeys.map((child) => classNameOf(elements[child]));
    scrollContainers.push({
      key,
      className,
      hasFlexWrap: /\bflex-wrap\b/.test(className),
      hasFlexNowrap: /\bflex-nowrap\b/.test(className),
      overflowX,
      snapType: pick(/\bsnap-[xy]?\b/, className),
      gridFlowCol: /\bgrid-flow-col\b/.test(className),
      childKeys,
      childShrinkZero: String(
        childClasses.every((cls) => /\bshrink-0\b/.test(cls)) &&
          childClasses.length > 0,
      ),
      childMinWidths: [
        ...new Set(
          childClasses.map((cls) => pick(/\bmin-w-\S+/, cls)).filter(Boolean),
        ),
      ].join(","),
    });
  }

  const products = spec.state?.["products"];
  return {
    model,
    ok: false,
    httpStatus: 0,
    bytes: raw.length,
    lines,
    patches,
    invalidLines,
    usage,
    root: spec.root ?? "",
    elementCount: Object.keys(elements).length,
    stateKeys: Object.keys(spec.state ?? {}),
    productsCount: Array.isArray(products) ? products.length : null,
    repeats,
    scrollContainers,
    flexWrapElements,
    minWidthNamed: [...new Set(minWidthNamed)],
    minWidthArbitrary: [...new Set(minWidthArbitrary)],
    maxWidthArbitrary: [...new Set(maxWidthArbitrary)],
  };
}

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

async function capture(modelId: string, slug: string): Promise<void> {
  process.stdout.write(`\n→ ${modelId} … `);
  let status = 0;
  let raw = "";
  let error: string | undefined;
  let code: string | undefined;

  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: PROMPT,
        context: { model: modelId },
        currentSpec: { root: "", elements: {} },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    const text = await response.text();
    if (!response.ok) {
      try {
        const parsed = JSON.parse(text) as { error?: string; code?: string };
        error = parsed.error ?? text.slice(0, 300);
        code = parsed.code;
      } catch {
        error = text.slice(0, 300);
      }
    } else {
      raw = text;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  const writePath = (suffix: string): string =>
    join(OUT_DIR, `${slug}${suffix}`);

  const foldResult = fold(raw);
  const analysis = analyze(modelId, raw, foldResult);
  analysis.ok = status === 200 && analysis.root !== "";
  analysis.httpStatus = status;
  if (error) analysis.error = error;
  if (code) analysis.code = code;

  writeFileSync(writePath(".raw.jsonl"), raw);
  writeFileSync(
    writePath(".spec.json"),
    JSON.stringify(foldResult.spec, null, 2) + "\n",
  );
  writeFileSync(
    writePath(".analysis.json"),
    JSON.stringify(analysis, null, 2) + "\n",
  );

  if (analysis.ok) {
    process.stdout.write(
      `200 ok · elements=${analysis.elementCount} products=${analysis.productsCount} ` +
        `repeats=[${analysis.repeats.map((r) => `${r.key}→${r.statePath}`).join(", ")}] ` +
        `wrap=[${analysis.flexWrapElements.join(",") || "-"}] ` +
        `containers=${analysis.scrollContainers.length} ` +
        `tokens=${analysis.usage?.totalTokens ?? "?"}`,
    );
  } else {
    process.stdout.write(
      `FAILED status=${status} code=${code ?? "-"} error=${error ?? "-"}`,
    );
  }
}

mkdirSync(OUT_DIR, { recursive: true });
// Optional argv: capture only the given slugs (e.g. to retry failures)
const requested = process.argv.slice(2);
const targets = requested.length
  ? MODELS.filter((model) => requested.includes(model.slug))
  : MODELS;
for (const model of targets) {
  await capture(model.id, model.slug);
}
process.stdout.write("\nDone.\n");
