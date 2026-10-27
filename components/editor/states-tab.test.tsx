import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { JSONUIProvider } from "@json-render/react";
import type { UIElement } from "@json-render/core";
import en from "@/lib/i18n/locale/en.json";
import { registry } from "@/lib/playground/registry";
import { StatesTab } from "@/components/editor/states-tab";

const STATE = {
  page: 0,
  queries: { pokedexList: { status: "success", data: [1, 2] } },
};

function renderTab(element: UIElement, state: Record<string, unknown> = STATE) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <JSONUIProvider registry={registry} initialState={state}>
        <StatesTab element={element} />
      </JSONUIProvider>
    </NextIntlClientProvider>,
  );
}

const loadingElement = {
  type: "Stack",
  visible: { $state: "/queries/pokedexList/status", eq: "loading" },
  watch: { "/page": { action: "data_read", params: {} } },
} as unknown as UIElement;

describe("StatesTab", () => {
  test("hidden condition renders the hidden verdict + condition JSON", () => {
    const html = renderTab(loadingElement);
    expect(html).toContain('data-state-verdict="hidden"');
    expect(html).toContain("status");
    expect(html).toContain(en.editor.states.hiddenNow);
  });

  test("watched paths list their state path", () => {
    const html = renderTab(loadingElement);
    expect(html).toContain("/page");
  });

  test("state inspector flags used paths in the open group", () => {
    const html = renderTab(loadingElement);
    expect(html).toContain('data-state-path="/page"');
    expect(html).toContain('data-state-path="/queries/pokedexList/status"');
    expect(html).toContain("success");
    // /page is watched, /queries/pokedexList/status is the condition — both used
    expect(html.match(/data-state-used="true"/g)?.length).toBe(2);
  });

  test("unconditional element says always shown", () => {
    const html = renderTab({ type: "Text" } as UIElement);
    expect(html).toContain(en.editor.states.alwaysShown);
    expect(html).not.toContain("data-state-verdict");
  });

  test("empty state renders the empty hint", () => {
    const html = renderTab({ type: "Text" } as UIElement, {});
    expect(html).toContain(en.editor.states.noState);
  });

  test("state rows split into used/other collapsibles — used open, other closed", () => {
    const html = renderTab(loadingElement);
    const usedIdx = html.indexOf('data-state-group="used"');
    const otherIdx = html.indexOf('data-state-group="other"');
    expect(usedIdx).toBeGreaterThan(-1);
    expect(otherIdx).toBeGreaterThan(usedIdx);
    const usedPart = html.slice(usedIdx, otherIdx);
    const otherPart = html.slice(otherIdx);
    // group labels + counts live in the triggers (always rendered)
    expect(usedPart).toContain(en.editor.states.usedGroup);
    expect(usedPart).toContain("2 paths");
    expect(otherPart).toContain(en.editor.states.otherGroup);
    expect(otherPart).toContain("1 path");
    // used content open by default → its rows render
    expect(usedPart).toContain('data-state-path="/page"');
    expect(usedPart).toContain('data-state-path="/queries/pokedexList/status"');
    expect(usedPart).not.toContain(
      'data-state-path="/queries/pokedexList/data"',
    );
    // other content closed by default → mounted but hidden, rows withheld
    expect(otherPart).toContain('data-state="closed"');
    expect(otherPart).not.toContain("data-state-path=");
  });

  test("element without state deps renders only the other group", () => {
    const html = renderTab({ type: "Text" } as UIElement);
    expect(html).not.toContain('data-state-group="used"');
    expect(html).toContain('data-state-group="other"');
    expect(html).not.toContain('data-state-used="true"');
  });

  test("used path missing from state still appears in the used group", () => {
    const html = renderTab(
      {
        type: "Text",
        visible: { $state: "/never/set", eq: 1 },
      } as unknown as UIElement,
      STATE,
    );
    const usedIdx = html.indexOf('data-state-group="used"');
    const otherIdx = html.indexOf('data-state-group="other"');
    expect(usedIdx).toBeGreaterThan(-1);
    const usedSection = html.slice(
      usedIdx,
      otherIdx > -1 ? otherIdx : undefined,
    );
    expect(usedSection).toContain('data-state-path="/never/set"');
    expect(usedSection).toContain("—");
  });
});
