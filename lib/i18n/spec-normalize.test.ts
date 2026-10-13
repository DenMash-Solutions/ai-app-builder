import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { normalizeSpecCopy } from "@/lib/i18n/spec-normalize";

function makeSpec(elements: Spec["elements"], state?: Spec["state"]): Spec {
  return { root: "root", elements, state };
}

describe("normalizeSpecCopy", () => {
  test("lifts whitelisted string props into state.copy with $state refs", () => {
    const spec = makeSpec(
      {
        root: { type: "Heading", props: { text: "Hello world" } },
        sub: {
          type: "Text",
          props: { text: "Some paragraph", className: "text-muted-foreground" },
        },
        btn: { type: "Button", props: { label: "Save now" } },
        input: { type: "Input", props: { placeholder: "Type here…" } },
      },
      { locale: "en" },
    );

    const result = normalizeSpecCopy(spec);
    expect(result.lifted).toHaveLength(4);
    expect(result.rewritten).toBe(4);
    expect(result.spec.state?.copy).toEqual({
      "hello-world": "Hello world",
      "some-paragraph": "Some paragraph",
      "save-now": "Save now",
      "type-here": "Type here…",
    });
    expect(
      (result.spec.elements.root.props as Record<string, unknown>).text,
    ).toEqual({ $state: "/copy/hello-world" });
    expect(
      (result.spec.elements.input.props as Record<string, unknown>).placeholder,
    ).toEqual({ $state: "/copy/type-here" });
    // Non-copy props untouched.
    expect(
      (result.spec.elements.sub.props as Record<string, unknown>).className,
    ).toBe("text-muted-foreground");
    // Existing state preserved alongside the copy bag.
    expect(result.spec.state?.locale).toBe("en");
  });

  test("idempotent — second run changes nothing", () => {
    const spec = makeSpec({
      root: { type: "Heading", props: { text: "Once" } },
    });
    const once = normalizeSpecCopy(spec);
    const twice = normalizeSpecCopy(once.spec);
    expect(twice.spec).toBe(once.spec);
    expect(twice.lifted).toEqual([]);
    expect(twice.rewritten).toBe(0);
  });

  test("expressions, non-strings and nested values are untouched", () => {
    const spec = makeSpec({
      root: {
        type: "Heading",
        props: {
          text: { $state: "/copy/already" },
          title: { $template: "Hi, ${/name}!" },
          description: { $cond: { $state: "/x" }, $then: "yes", $else: "no" },
          alt: 42,
          content: ["nested", "array"],
          caption: { inner: "not lifted" },
          label: "",
          message: "   ",
        },
      },
    });
    const result = normalizeSpecCopy(spec);
    expect(result.spec).toBe(spec);
    expect(result.spec.state?.copy).toBeUndefined();
  });

  test("identical strings share one key; slug collisions get suffixes", () => {
    const spec = makeSpec({
      a: { type: "Button", props: { label: "Learn more" } },
      b: { type: "Link", props: { text: "Learn more" } },
      c: { type: "Button", props: { label: "learn-more!" } },
    });
    const result = normalizeSpecCopy(spec);
    expect(result.spec.state?.copy).toEqual({
      "learn-more": "Learn more",
      "learn-more-2": "learn-more!",
    });
    expect(
      (result.spec.elements.a.props as Record<string, unknown>).label,
    ).toEqual({ $state: "/copy/learn-more" });
    expect(
      (result.spec.elements.b.props as Record<string, unknown>).text,
    ).toEqual({ $state: "/copy/learn-more" });
    expect(
      (result.spec.elements.c.props as Record<string, unknown>).label,
    ).toEqual({ $state: "/copy/learn-more-2" });
  });

  test("reuses an existing seed key with the same value", () => {
    const spec = makeSpec(
      { root: { type: "Button", props: { label: "Sign in" } } },
      { locale: "en", copy: { submit: "Sign in" } },
    );
    const result = normalizeSpecCopy(spec);
    expect(result.lifted).toEqual([]);
    expect(result.rewritten).toBe(1);
    expect(result.spec.state?.copy).toEqual({ submit: "Sign in" });
    expect(
      (result.spec.elements.root.props as Record<string, unknown>).label,
    ).toEqual({ $state: "/copy/submit" });
  });

  test("handles specs without state or elements", () => {
    const empty = makeSpec({});
    expect(normalizeSpecCopy(empty).spec).toBe(empty);
    const noState = makeSpec({
      root: { type: "Heading", props: { text: "Fresh" } },
    });
    const result = normalizeSpecCopy(noState);
    expect(result.spec.state).toEqual({ copy: { fresh: "Fresh" } });
  });
});
