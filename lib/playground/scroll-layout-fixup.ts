import type { Spec, UIElement } from "@json-render/core";

const SCROLL_CONTAINER_RE = /\boverflow-x-(?:auto|scroll)\b/;

/** Strips responsive/important variants: "md:!w-full" → "w-full". */
function baseToken(token: string): string {
  const value = token.startsWith("!") ? token.slice(1) : token;
  const colon = value.lastIndexOf(":");
  return colon >= 0 ? value.slice(colon + 1) : value;
}

function classNameOf(element: UIElement | undefined): string {
  const className = element?.props?.["className"];
  return typeof className === "string" ? className : "";
}

function hasWidth(className: string): boolean {
  for (const token of className.split(/\s+/)) {
    const base = baseToken(token);
    if (base.startsWith("min-w-") || base.startsWith("max-w-")) continue;
    if (base.startsWith("w-")) return true;
  }
  return false;
}

function hasMinWidth(className: string): boolean {
  return className
    .split(/\s+/)
    .some((token) => baseToken(token).startsWith("min-w-"));
}

function hasNowrap(className: string): boolean {
  return className
    .split(/\s+/)
    .some((token) => baseToken(token).startsWith("flex-nowrap"));
}

/**
 * Classes a scroll container itself needs so the row actually scrolls:
 *
 * - The shadcn `Stack` renderer hardcodes `flex-row flex-wrap` for
 *   `direction: "horizontal"` — appending `flex-nowrap` last lets
 *   tailwind-merge in `cn()` drop the injected wrap (models cannot win by
 *   prompt compliance alone; only 1/5 models emitted `flex-nowrap`).
 * - Parent Stacks default to `items-start`, so a container without an
 *   explicit width shrink-wraps to its content (measured: a 2228px-wide
 *   "carousel" whose own overflow never engaged and the whole canvas scrolled
 *   sideways) — `w-full` pins it, `min-w-0` lets it shrink as a flex child.
 *
 * Explicit model choices win: `w-*` suppresses `w-full`, `min-w-*` suppresses
 * `min-w-0`, an existing `flex-nowrap` is not duplicated.
 */
export function scrollContainerClasses(className: string): string {
  if (!SCROLL_CONTAINER_RE.test(className)) return "";

  const extras: string[] = [];
  if (!hasNowrap(className)) extras.push("flex-nowrap");
  if (!hasWidth(className)) extras.push("w-full");
  if (!hasMinWidth(className)) extras.push("min-w-0");
  return extras.join(" ");
}

/**
 * Derived render-time layout fixup for horizontal carousels. The stored spec
 * stays exactly what the model produced (decision 5); the Renderer receives
 * this fixed-up copy instead:
 *
 * 1. Every element with `overflow-x-auto|scroll` gets `scrollContainerClasses`
 *    (defeats the Stack's injected `flex-wrap`, pins width).
 * 2. Every spec ANCESTOR of such an element gets `w-full` when it declares no
 *    width of its own. Without this the fixup is circular: a `nowrap` row has
 *    a huge min-content, parent Stacks size to fit-content (`items-start`,
 *    `mx-auto`), and `w-full` on the container resolves against a
 *    content-sized parent — measured on gemini-3.5-flash-lite: container
 *    2332px wide, its own scroll never engaged, the whole canvas scrolled.
 *
 * Returns the input reference when nothing changes. `style`-prop widths are
 * respected implicitly (inline style beats any class we could add).
 */
export function fixupScrollLayout(spec: Spec): Spec {
  const elements = spec.elements ?? {};

  const parentOf = new Map<string, string>();
  for (const [key, element] of Object.entries(elements)) {
    for (const child of element.children ?? []) {
      if (typeof child === "string") parentOf.set(child, key);
    }
  }

  const nextElements: Record<string, UIElement> = { ...elements };
  let changed = false;

  const setClassName = (key: string, className: string): void => {
    const element = nextElements[key];
    if (!element) return;
    nextElements[key] = {
      ...element,
      props: { ...(element.props ?? {}), className },
    };
    changed = true;
  };

  // Pass 1 — the scroll containers themselves.
  const scrollKeys: string[] = [];
  for (const [key, element] of Object.entries(elements)) {
    const className = classNameOf(element);
    if (!SCROLL_CONTAINER_RE.test(className)) continue;
    scrollKeys.push(key);
    const extras = scrollContainerClasses(className);
    if (extras) setClassName(key, `${className} ${extras}`.trim());
  }

  // Pass 2 — make the ancestor chain width-definite (deduped walks).
  const ancestors = new Set<string>();
  for (const key of scrollKeys) {
    let cursor = parentOf.get(key);
    while (cursor !== undefined) {
      ancestors.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  for (const key of ancestors) {
    const className = classNameOf(nextElements[key]);
    if (hasWidth(className)) continue;
    setClassName(key, className ? `${className} w-full`.trim() : "w-full");
  }

  if (!changed) return spec;
  return { ...spec, elements: nextElements };
}
