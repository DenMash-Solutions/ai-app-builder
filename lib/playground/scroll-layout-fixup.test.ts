import { describe, expect, test } from "bun:test";
import type { Spec, UIElement } from "@json-render/core";
import {
  fixupScrollLayout,
  scrollContainerClasses,
} from "./scroll-layout-fixup";

function el(
  type: string,
  className: string | null,
  children: string[] = [],
): UIElement {
  return {
    type,
    ...(className === null ? {} : { props: { className } }),
    ...(children.length > 0 ? { children } : {}),
  } as UIElement;
}

describe("scrollContainerClasses", () => {
  test("leaves non-scroll elements untouched", () => {
    expect(scrollContainerClasses("flex gap-3 items-start")).toBe("");
    expect(scrollContainerClasses("overflow-y-auto")).toBe("");
    expect(scrollContainerClasses("")).toBe("");
  });

  test("adds nowrap + width constraints to a bare scroll container", () => {
    expect(scrollContainerClasses("overflow-x-auto snap-x py-4")).toBe(
      "flex-nowrap w-full min-w-0",
    );
  });

  test("covers overflow-x-scroll too", () => {
    expect(scrollContainerClasses("overflow-x-scroll")).toContain(
      "flex-nowrap",
    );
  });

  test("an explicit model width suppresses w-full", () => {
    const extras = scrollContainerClasses("overflow-x-auto w-72");
    expect(extras).not.toContain("w-full");
    expect(extras).toContain("flex-nowrap");
    expect(extras).toContain("min-w-0");
  });

  test("variant and important width tokens count as width", () => {
    expect(scrollContainerClasses("overflow-x-auto md:w-1/2")).not.toContain(
      "w-full",
    );
    expect(scrollContainerClasses("overflow-x-auto !w-fit")).not.toContain(
      "w-full",
    );
  });

  test("min-w-* / max-w-* are not mistaken for width", () => {
    expect(scrollContainerClasses("overflow-x-auto min-w-64")).not.toContain(
      "min-w-0",
    );
    expect(scrollContainerClasses("overflow-x-auto min-w-64")).toContain(
      "w-full",
    );
    expect(scrollContainerClasses("overflow-x-auto max-w-md")).toContain(
      "w-full",
    );
  });

  test("an existing flex-nowrap is not duplicated", () => {
    const extras = scrollContainerClasses("overflow-x-auto flex-nowrap");
    expect(extras).not.toContain("flex-nowrap");
    expect(extras).toContain("w-full");
  });

  test("appends after existing classes so tailwind-merge keeps nowrap", () => {
    // The Stack impl does cn("flex", "flex-row flex-wrap", …, props.className)
    // — appending last makes tailwind-merge drop the injected wrap.
    const merged = [
      "flex",
      "flex-row",
      "flex-wrap",
      "items-start",
      "overflow-x-auto",
      scrollContainerClasses("overflow-x-auto"),
    ].join(" ");
    const tokens = merged.split(" ");
    expect(tokens.lastIndexOf("flex-nowrap")).toBeGreaterThan(
      tokens.indexOf("flex-wrap"),
    );
  });
});

describe("fixupScrollLayout", () => {
  const carousel = (): Spec =>
    ({
      root: "page",
      elements: {
        page: el("Stack", "p-6", ["section"]),
        section: el("Stack", null, ["row"]),
        row: el("Stack", "flex overflow-x-auto snap-x", ["card"]),
        card: el("Card", "shrink-0 min-w-64"),
      },
    }) as Spec;

  test("returns the same reference when no scroll container exists", () => {
    const spec = {
      root: "page",
      elements: { page: el("Stack", "flex flex-col", ["text"]) },
    } as Spec;
    expect(fixupScrollLayout(spec)).toBe(spec);
  });

  test("fixes the container and every ancestor up to the root", () => {
    const result = fixupScrollLayout(carousel());
    const cls = (key: string): string =>
      (result.elements[key]?.props?.["className"] as string) ?? "";
    expect(cls("row")).toBe(
      "flex overflow-x-auto snap-x flex-nowrap w-full min-w-0",
    );
    expect(cls("section")).toContain("w-full");
    expect(cls("page")).toContain("w-full");
    expect(cls("card")).toBe("shrink-0 min-w-64");
  });

  test("keeps ancestor widths the model already declared", () => {
    const spec = carousel();
    spec.elements["section"] = el("Stack", "w-3/4 max-w-5xl", ["row"]);
    const result = fixupScrollLayout(spec);
    expect(result.elements["section"]?.props?.["className"]).toBe(
      "w-3/4 max-w-5xl",
    );
    expect(result.elements["page"]?.props?.["className"]).toContain("w-full");
  });

  test("creates props when an ancestor has no className", () => {
    const result = fixupScrollLayout(carousel());
    expect(result.elements["section"]?.props?.["className"]).toBe("w-full");
  });

  test("is idempotent", () => {
    const once = fixupScrollLayout(carousel());
    expect(fixupScrollLayout(once)).toBe(once);
  });

  test("never mutates the input spec", () => {
    const spec = carousel();
    const before = JSON.stringify(spec);
    fixupScrollLayout(spec);
    expect(JSON.stringify(spec)).toBe(before);
  });

  test("walks through repeat children (string keys)", () => {
    const spec = {
      root: "page",
      elements: {
        page: el("Stack", "p-6", ["repeater"]),
        repeater: el("Stack", "flex overflow-x-auto", ["item"]),
        item: el("Card", "shrink-0 w-64"),
      },
    } as Spec;
    const result = fixupScrollLayout(spec);
    expect(result.elements["page"]?.props?.["className"]).toContain("w-full");
    expect(result.elements["repeater"]?.props?.["className"]).toContain(
      "flex-nowrap",
    );
  });
});
