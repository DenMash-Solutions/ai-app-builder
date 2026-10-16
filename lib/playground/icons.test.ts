import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BaseComponentProps } from "@json-render/react";
import { icons } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  LUCIDE_ICON_COMPONENTS,
  LUCIDE_ICON_NAMES,
  IconImpl,
} from "@/lib/playground/icons";
import { withStyleProps } from "@/lib/playground/with-style-props";

/** "trash-2" → "Trash2" (kebab key → lucide export name). */
function pascal(key: string): string {
  return key
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

describe("LUCIDE_ICON_COMPONENTS", () => {
  const keys = Object.keys(LUCIDE_ICON_COMPONENTS);

  test("every key is kebab-case (the catalog's name enum shape)", () => {
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("key ↔ installed lucide-react export parity (v1 renamed icons)", () => {
    for (const [key, component] of Object.entries(LUCIDE_ICON_COMPONENTS)) {
      const exported = (icons as Record<string, LucideIcon | undefined>)[
        pascal(key)
      ];
      expect(
        exported,
        `${key} → ${pascal(key)} missing in lucide-react`,
      ).toBeDefined();
      expect(component).toBe(exported as LucideIcon);
    }
  });

  test("names are derived from the map keys", () => {
    expect([...LUCIDE_ICON_NAMES]).toEqual(keys);
    expect(keys.length).toBeGreaterThan(100);
  });
});

function ctx(
  props: Record<string, unknown>,
  onEmit?: (event: string) => void,
): BaseComponentProps<Record<string, unknown>> {
  return {
    props,
    emit: (event: string) => onEmit?.(event),
    on: () => ({ emit: () => {}, shouldPreventDefault: false, bound: false }),
  } as unknown as BaseComponentProps<Record<string, unknown>>;
}

describe("IconImpl", () => {
  test("draws the mapped icon as SVG with the default size 16", () => {
    const html = renderToStaticMarkup(
      createElement(IconImpl, { ...ctx({ name: "sparkles" }) }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
  });

  test("honors an explicit size and emits press on click", () => {
    const events: string[] = [];
    const node = IconImpl(
      ctx({ name: "trash", size: 20 }, (event) => events.push(event)),
    ) as ReactElement<{ size?: number; onClick?: () => void }>;
    expect(node.props.size).toBe(20);
    (node.props.onClick as () => void)();
    expect(events).toEqual(["press"]);
  });

  test("draws nothing for an unknown or missing name (non-blocking ingest)", () => {
    expect(IconImpl(ctx({ name: "not-a-real-icon" }))).toBeNull();
    expect(IconImpl(ctx({}))).toBeNull();
  });

  test("withStyleProps merges catalog className/style onto the SVG", () => {
    const node = withStyleProps(
      IconImpl as unknown as Parameters<typeof withStyleProps>[0],
    )(
      ctx({ name: "sparkles", className: "text-muted-foreground" }),
    ) as ReactElement<{ className?: string }>;
    expect(node.props.className).toBe("text-muted-foreground");
  });
});
