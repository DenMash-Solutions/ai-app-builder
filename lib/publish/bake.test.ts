import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { bakeHtmlByLanguage, classifySpec } from "./bake";

const contentSpec: Spec = {
  root: "h",
  elements: {
    h: {
      type: "Heading",
      props: { text: { $state: "/copy/title" }, level: "h1" },
      children: [],
    },
  },
  state: {
    locale: "en",
    copy: { title: "Hello" },
    i18n: { es: { title: "Hola" } },
  },
};

describe("classifySpec", () => {
  test("a plain content spec is content", () => {
    expect(classifySpec(contentSpec)).toBe("content");
  });

  test("event bindings, watchers and store binds are stateful", () => {
    expect(
      classifySpec({
        root: "b",
        elements: {
          b: {
            type: "Button",
            props: { label: "Go" },
            on: { press: { action: "setState", params: {} } },
          },
        },
      }),
    ).toBe("stateful");
    expect(
      classifySpec({
        root: "t",
        elements: {
          t: { type: "Text", props: { text: { $bindState: "/n" } } },
        },
      }),
    ).toBe("stateful");
    expect(
      classifySpec({
        root: "t",
        elements: {
          t: {
            type: "Text",
            props: { text: "x" },
            watch: { "/n": { action: "setState", params: {} } },
          },
        },
      }),
    ).toBe("stateful");
  });
});

describe("bakeHtmlByLanguage (SSR smoke)", () => {
  test("renders one artifact per language with merged copy", () => {
    const html = bakeHtmlByLanguage(contentSpec);
    expect(Object.keys(html).sort()).toEqual(["en", "es"]);
    expect(html.en).toContain("Hello");
    expect(html.es).toContain("Hola");
    expect(html.es).not.toContain("Hello");
  });

  test("resolves computed directives at bake time", () => {
    const spec: Spec = {
      root: "h",
      elements: {
        h: {
          type: "Heading",
          props: {
            level: "h1",
            // $count($filter($state)) — args nested inside the $filter value
            // (the shape models emit) must resolve, not drop the condition.
            text: {
              $concat: [
                {
                  $count: {
                    $filter: { $state: "/todos", field: "done", value: false },
                  },
                },
                " remaining",
              ],
            },
          },
        },
      },
      state: {
        todos: [
          { id: 1, done: true },
          { id: 2, done: false },
          { id: 3, done: false },
        ],
      },
    };
    const html = bakeHtmlByLanguage(spec);
    expect(html.en).toContain("2 remaining");
  });
});
