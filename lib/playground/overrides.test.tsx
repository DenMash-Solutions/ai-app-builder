import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import { StateProvider, ValidationProvider } from "@json-render/react";
import { ButtonImpl, GridImpl, InputImpl } from "@/lib/playground/overrides";

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

interface ButtonNodeProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  className?: string;
}

/** The provider stack the Input hooks rely on (mirrors JSONUIProvider). */
function renderInput(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    <StateProvider initialState={{}}>
      <ValidationProvider customFunctions={{}}>
        <InputImpl {...ctx(props)} />
      </ValidationProvider>
    </StateProvider>,
  );
}

describe("ButtonImpl (D5 icon props)", () => {
  test("draws leading/trailing icons around the label", () => {
    const node = ButtonImpl(
      ctx({
        label: "Next",
        leadingIcon: "arrow-left",
        trailingIcon: "arrow-right",
      }),
    ) as ReactElement<ButtonNodeProps>;
    const html = renderToStaticMarkup(node);
    const leadingAt = html.indexOf("lucide-arrow-left");
    const labelAt = html.indexOf("Next");
    const trailingAt = html.indexOf("lucide-arrow-right");
    expect(leadingAt).toBeGreaterThanOrEqual(0);
    expect(trailingAt).toBeGreaterThanOrEqual(0);
    expect(leadingAt).toBeLessThan(labelAt);
    expect(labelAt).toBeLessThan(trailingAt);
  });

  test("unknown icon names degrade to a plain label", () => {
    const node = ButtonImpl(
      ctx({ label: "Go", leadingIcon: "definitely-not-an-icon" }),
    ) as ReactElement<ButtonNodeProps>;
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Go");
    expect(html).not.toContain("<svg");
  });

  test("click emits a single press — icons inside don't double-fire", () => {
    const events: string[] = [];
    const node = ButtonImpl(
      ctx(
        {
          label: "Next",
          leadingIcon: "arrow-left",
          trailingIcon: "arrow-right",
        },
        (event) => events.push(event),
      ),
    ) as ReactElement<ButtonNodeProps>;
    node.props.onClick?.();
    expect(events).toEqual(["press"]);
  });

  test("variant mapping and disabled pass through to the button", () => {
    const danger = ButtonImpl(
      ctx({ label: "Delete", variant: "danger", disabled: true }),
    ) as ReactElement<ButtonNodeProps>;
    expect(danger.props.variant).toBe("destructive");
    expect(danger.props.disabled).toBe(true);

    const plain = ButtonImpl(
      ctx({ label: "Go" }),
    ) as ReactElement<ButtonNodeProps>;
    expect(plain.props.variant).toBe("default");
    expect(plain.props.disabled).toBe(false);
    // No icons → no injected gap class (the catalog's className still merges
    // on top through withStyleProps).
    expect(plain.props.className).toBeUndefined();
  });
});

describe("InputImpl (D7 change event)", () => {
  test("renders label, name and placeholder as a real input", () => {
    const html = renderInput({
      label: "Search icons",
      name: "search",
      type: "text",
      placeholder: "Filter by name",
    });
    expect(html).toContain('data-slot="input"');
    expect(html).toContain('name="search"');
    expect(html).toContain('placeholder="Filter by name"');
    expect(html).toContain("Search icons");
    expect(html).toContain('value=""');
  });

  test("a non-string label renders the input without a broken label node", () => {
    const html = renderInput({
      name: "email",
      type: "email",
      placeholder: "",
    });
    expect(html).toContain('type="email"');
    expect(html).not.toContain("<label");
  });
});

describe("GridImpl (D3 responsive columns)", () => {
  function renderGrid(props: Record<string, unknown>): string {
    return renderToStaticMarkup(
      GridImpl({
        ...ctx(props),
        children: "cells",
      } as unknown as BaseComponentProps<Record<string, unknown>>),
    );
  }

  test("columns is the desktop target — the ladder fills phones with 1–2 columns", () => {
    expect(renderGrid({ columns: 1 })).toContain("grid-cols-1");
    expect(renderGrid({ columns: 1 })).not.toContain("sm:grid-cols-2");

    const two = renderGrid({ columns: 2 });
    expect(two).toContain("grid-cols-1");
    expect(two).toContain("sm:grid-cols-2");
    expect(two).not.toContain("lg:");

    expect(renderGrid({ columns: 3 })).toContain("lg:grid-cols-3");
    expect(renderGrid({ columns: 5 })).toContain("lg:grid-cols-5");
    // Phones still get the single-column base at every target.
    for (const columns of [1, 2, 3, 5]) {
      expect(renderGrid({ columns })).toContain("grid-cols-1");
    }
  });

  test("keeps upstream's 1–6 clamp and defaults to a single column", () => {
    expect(renderGrid({ columns: 9 })).toContain("lg:grid-cols-6");
    expect(renderGrid({ columns: 0 })).toContain("grid-cols-1");
    expect(renderGrid({ columns: -2 })).toContain("grid-cols-1");
    expect(renderGrid({ columns: null })).toContain("grid-cols-1");
    expect(renderGrid({})).toContain("grid-cols-1");
  });

  test("grid chrome, gap map and className merge match upstream", () => {
    const html = renderGrid({ columns: 3, gap: "lg" });
    expect(html).toContain('class="grid');
    expect(html).toContain("gap-4");
    expect(html).toContain("cells");

    expect(renderGrid({ columns: 3 })).toContain("gap-3");
    expect(renderGrid({ columns: 3, gap: "none" })).toContain("gap-3");
    expect(renderGrid({ className: "mt-4" })).toContain("mt-4");
  });
});
