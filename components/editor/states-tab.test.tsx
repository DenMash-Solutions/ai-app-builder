import { describe, expect, test, afterEach } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { JSONUIProvider } from "@json-render/react";
import type { UIElement } from "@json-render/core";
import en from "@/lib/i18n/locale/en.json";
import { registry } from "@/lib/playground/registry";
import { stateOverrides } from "@/lib/editor/state-overrides";
import { StatesTab } from "@/components/editor/states-tab";

afterEach(() => {
  // overrides are module-scoped — never leak between render tests
  stateOverrides.clear();
});

const STATE = {
  page: 0,
  queries: { pokedexList: { status: "success", data: [1, 2] } },
};

function renderTab(element: UIElement, state: Record<string, unknown> = STATE) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <JSONUIProvider registry={registry} initialState={state}>
        <StatesTab
          element={element}
          spec={{ root: "r", elements: {}, state }}
          onConditionChange={() => {}}
        />
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

  test("rows offer an edit control — pencil for plain paths, select for status", () => {
    const html = renderTab(loadingElement);
    // non-status rows get the pencil
    expect(html).toContain('data-state-edit="/page"');
    // the status row gets the lifecycle select instead
    expect(html).toContain(
      'data-state-status-select="/queries/pokedexList/status"',
    );
    expect(html).not.toContain('data-state-edit="/queries/pokedexList/status"');
    expect(html).not.toContain("data-state-reset-overrides");
    expect(html).not.toContain('data-state-overridden="true"');
  });

  test("status select trigger shows the current value", () => {
    // options render in the Radix portal (closed in SSR) — they are covered
    // by statusSelectOptions unit tests; here the trigger value must show.
    const html = renderTab(loadingElement);
    expect(html).toContain(">success<");
  });

  test("a recorded override marks its row and reveals the reset button", () => {
    stateOverrides.record("/page", 0);
    const html = renderTab(loadingElement);
    expect(html).toContain('data-state-path="/page"');
    expect(html).toMatch(
      /data-state-path="\/page"[^>]*data-state-overridden="true"/,
    );
    expect(html).toContain("data-state-reset-overrides");
  });
});

describe("StatesTab condition form", () => {
  test("single condition renders one editable row (path/operator/value)", () => {
    const html = renderTab(loadingElement);
    expect(html).toContain("data-condition-form");
    expect(html).toContain('data-condition-path="0"');
    expect(html).toContain('data-condition-operator="0"');
    expect(html).toContain('data-condition-value="0"');
    expect(html).toContain("/queries/pokedexList/status");
    // operator dropdown shows the committed operator
    expect(html).toContain(">eq<");
    // a single row is not removable, and nothing falls back to raw JSON
    expect(html).not.toContain("data-condition-remove");
    expect(html).not.toContain("data-condition-raw");
  });

  test("array condition renders one row per clause with remove controls", () => {
    const html = renderTab({
      type: "Text",
      visible: [
        { $state: "/queries/pokedexList/count", eq: 0 },
        { $state: "/queries/pokedexList/status", eq: "success" },
      ],
    } as unknown as UIElement);
    expect(html).toContain('data-condition-row="1"');
    expect(html).toContain('data-condition-value="1"');
    expect(html).toContain('data-condition-remove="0"');
    expect(html).toContain("data-condition-add");
    expect(html).not.toContain("data-condition-raw");
  });

  test("$and wrapper renders as an editable row list (real spec shape)", () => {
    const html = renderTab({
      type: "Text",
      visible: {
        $and: [
          { $state: "/queries/pokemonList/count", eq: 0 },
          { $state: "/queries/pokemonList/status", eq: "success" },
        ],
      },
    } as unknown as UIElement);
    expect(html).toContain("data-condition-form");
    expect(html).toContain('data-condition-path="1"');
    expect(html).toContain('data-condition-remove="0"');
    expect(html).not.toContain("data-condition-raw");
  });

  test("unsupported condition shape falls back to raw JSON", () => {
    const html = renderTab({
      type: "Text",
      visible: {
        $or: [
          { $state: "/page", eq: 1 },
          { $state: "/limit", eq: 2 },
        ],
      },
    } as unknown as UIElement);
    expect(html).toContain("data-condition-raw");
    expect(html).toContain("$or"); // raw JSON lands in the <pre> (quotes escaped)
    expect(html).not.toContain("data-condition-form");
  });

  test("path suggestions come from spec.state pointers", () => {
    const html = renderTab(loadingElement);
    expect(html).toContain('id="condition-path-suggestions"');
    expect(html).toContain('value="/page"');
    expect(html).toContain('value="/queries/pokedexList/status"');
  });
});
