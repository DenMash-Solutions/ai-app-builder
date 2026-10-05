import { describe, expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import type { ReactElement } from "react";
import type { BaseComponentProps } from "@json-render/react";
import { withStyleProps } from "./with-style-props";

function ctx(
  props: Record<string, unknown>,
): BaseComponentProps<Record<string, unknown>> {
  return {
    props,
    emit: () => {},
    on: () => ({ emit: () => {}, shouldPreventDefault: false, bound: false }),
  };
}

function renderStyled(
  Impl: (ctx: BaseComponentProps<Record<string, unknown>>) => React.ReactNode,
  props: Record<string, unknown>,
): React.ReactNode {
  return withStyleProps(Impl)(ctx(props));
}

function hostProps(node: React.ReactNode): Record<string, unknown> {
  return (node as ReactElement).props as Record<string, unknown>;
}

describe("withStyleProps", () => {
  test("merges className onto a host root, new classes winning conflicts", () => {
    const Impl = () =>
      createElement("button", { className: "base bg-blue-500" }, "Go");
    const tree = renderStyled(Impl, {
      className: "w-full bg-blue-400",
    }) as ReactElement;
    expect(hostProps(tree).className).toBe("base w-full bg-blue-400");
  });

  test("merges style onto a host root, new values winning", () => {
    const Impl = () =>
      createElement("div", {
        style: { color: "red", padding: 4 },
      });
    const tree = renderStyled(Impl, {
      style: { color: "blue", backgroundColor: "navy" },
    }) as ReactElement;
    expect(hostProps(tree).style).toEqual({
      color: "blue",
      padding: 4,
      backgroundColor: "navy",
    });
  });

  test("passes className through a composite root while keeping composed classes", () => {
    const Composite = ({ className }: { className?: string }) =>
      createElement("i", { className });
    const Impl = () =>
      createElement(Composite, { className: "max-w-sm mx-auto" });
    const tree = renderStyled(Impl, { className: "w-full" }) as ReactElement;
    expect(hostProps(tree).className).toBe("max-w-sm mx-auto w-full");
  });

  test("styles only the first branch of a fragment root", () => {
    const Impl = () =>
      createElement(
        Fragment,
        null,
        createElement("span", null, "first"),
        createElement("span", null, "second"),
      );
    const tree = renderStyled(Impl, {
      className: "text-blue-950",
    }) as ReactElement<{
      children: ReactElement[];
    }>;
    const children = tree.props.children as ReactElement[];
    expect(hostProps(children[0]).className).toBe("text-blue-950");
    expect(hostProps(children[1]).className).toBeUndefined();
  });

  test("styles only the first element of an array root", () => {
    const Impl = () => [
      createElement("li", null, "one"),
      createElement("li", null, "two"),
    ];
    const tree = renderStyled(Impl, {
      className: "font-bold",
    }) as ReactElement[];
    expect(hostProps(tree[0]).className).toBe("font-bold");
    expect(hostProps(tree[1]).className).toBeUndefined();
  });

  test("returns the impl tree untouched when no style props are set", () => {
    const element = createElement("div", { className: "pre" }, "hi");
    const Impl = () => element;
    expect(renderStyled(Impl, {})).toBe(element);
    expect(renderStyled(Impl, { className: "" })).toBe(element);
    expect(renderStyled(Impl, { style: {} })).toBe(element);
  });

  test("always calls the impl exactly once, even without style props", () => {
    let calls = 0;
    const Impl = () => {
      calls += 1;
      return createElement("div");
    };
    renderStyled(Impl, {});
    renderStyled(Impl, { className: "w-full" });
    expect(calls).toBe(2);
  });

  test("handles null and text-only trees", () => {
    const NullImpl = () => null;
    expect(renderStyled(NullImpl, { className: "w-full" })).toBeNull();
    const TextImpl = () => "plain";
    expect(renderStyled(TextImpl, { className: "w-full" })).toBe("plain");
  });

  test("applies style alone when className is empty", () => {
    const Impl = () => createElement("div");
    const tree = renderStyled(Impl, {
      className: "",
      style: { width: "100%" },
    }) as ReactElement;
    expect(hostProps(tree).style).toEqual({ width: "100%" });
    expect(hostProps(tree).className).toBeUndefined();
  });
});
