import { describe, expect, it } from "bun:test";
import {
  SWITCH_LANGUAGE_ACTION,
  hasLanguageSwitcher,
  hasSwitchLanguageBinding,
  withLanguageSwitcherOption,
  withSwitchLanguageBinding,
} from "@/lib/i18n/language-switcher";

type AnySpec = Parameters<typeof withLanguageSwitcherOption>[0];

function specWith(buttons: unknown[], i18n?: Record<string, unknown>) {
  return {
    root: "page",
    state: {
      locale: "en",
      copy: { title: "Hello" },
      i18n: i18n ?? { es: { title: "Hola" } },
    },
    elements: {
      page: { type: "Stack", props: {}, children: ["lang-toggle"] },
      "lang-toggle": {
        type: "ButtonGroup",
        props: { buttons, selected: { $bindState: "/locale" } },
        children: [],
      },
    },
  } as unknown as AnySpec;
}

const ES_EN = [
  { label: "ES", value: "es" },
  { label: "EN", value: "en" },
];

/** The switcher's buttons on a spec (test-side structural read). */
function toggleButtons(spec: AnySpec): unknown[] {
  const elements = spec.elements as unknown as Record<
    string,
    { props: { buttons: unknown[] } }
  >;
  return elements["lang-toggle"].props.buttons;
}

describe("withLanguageSwitcherOption", () => {
  it("adds the language as an uppercase-tag option (spec untouched)", () => {
    const spec = specWith(structuredClone(ES_EN));
    const result = withLanguageSwitcherOption(spec, "fr", true);
    expect(toggleButtons(result)).toEqual([
      { label: "ES", value: "es" },
      { label: "EN", value: "en" },
      { label: "FR", value: "fr" },
    ]);
    // Pure: the input keeps its original buttons.
    expect(toggleButtons(spec)).toEqual(ES_EN);
  });

  it("returns the same spec when the option is already present", () => {
    const spec = specWith(
      [...structuredClone(ES_EN), { label: "PT-BR", value: "pt-BR" }],
      { es: { title: "Hola" }, "pt-BR": { title: "Olá" } },
    );
    expect(withLanguageSwitcherOption(spec, "pt-BR", true)).toBe(spec);
  });

  it("drops the removed language's option and keeps the rest", () => {
    const spec = specWith([
      { label: "ES", value: "es" },
      { label: "EN", value: "en" },
      { label: "FR", value: "fr" },
    ]);
    const result = withLanguageSwitcherOption(spec, "fr", false);
    expect(toggleButtons(result)).toEqual([
      { label: "ES", value: "es" },
      { label: "EN", value: "en" },
    ]);
  });

  it("returns the same spec when the option is already gone", () => {
    const spec = specWith(structuredClone(ES_EN));
    expect(withLanguageSwitcherOption(spec, "fr", false)).toBe(spec);
  });

  it("never touches non-language ButtonGroups (tag-shaped values alone don't qualify)", () => {
    const stepper = {
      root: "page",
      state: { locale: "en", copy: {} },
      elements: {
        steps: {
          type: "ButtonGroup",
          props: {
            buttons: [
              { label: "One", value: "one" },
              { label: "Two", value: "two" },
            ],
          },
          children: [],
        },
      },
    } as unknown as AnySpec;
    expect(withLanguageSwitcherOption(stepper, "fr", true)).toBe(stepper);
    expect(hasLanguageSwitcher(stepper)).toBe(false);
  });

  it("ignores a language group whose codes the spec does not carry", () => {
    const spec = {
      root: "page",
      state: { locale: "en", copy: {} },
      elements: {
        toggle: {
          type: "ButtonGroup",
          props: {
            buttons: [
              { label: "JA", value: "ja" },
              { label: "KO", value: "ko" },
            ],
          },
          children: [],
        },
      },
    } as unknown as AnySpec;
    expect(withLanguageSwitcherOption(spec, "fr", true)).toBe(spec);
    expect(hasLanguageSwitcher(spec)).toBe(false);
  });

  it("no-ops on specs without elements", () => {
    const bare = {
      root: "page",
      state: { locale: "en", copy: {} },
    } as unknown as AnySpec;
    expect(withLanguageSwitcherOption(bare, "fr", true)).toBe(bare);
    expect(hasLanguageSwitcher(bare)).toBe(false);
  });

  it("detects the switcher on a denmash-shaped spec", () => {
    expect(hasLanguageSwitcher(specWith(structuredClone(ES_EN)))).toBe(true);
  });
});

describe("withSwitchLanguageBinding", () => {
  it("binds switch_language on the switcher's change event", () => {
    const spec = specWith(structuredClone(ES_EN));
    const result = withSwitchLanguageBinding(spec);
    const toggle = (
      result.elements as unknown as Record<
        string,
        { on: { change: Array<{ action: string; params: unknown }> } }
      >
    )["lang-toggle"];
    expect(toggle.on.change).toEqual([
      {
        action: SWITCH_LANGUAGE_ACTION,
        params: { tag: { $state: "/locale" } },
      },
    ]);
    // The input is never mutated — the fix-up is pure.
    expect(
      (spec.elements as Record<string, { on?: unknown }>)["lang-toggle"].on,
    ).toBeUndefined();
  });

  it("is idempotent and detection agrees", () => {
    const bound = withSwitchLanguageBinding(specWith(structuredClone(ES_EN)));
    expect(withSwitchLanguageBinding(bound)).toBe(bound);
    expect(hasSwitchLanguageBinding(bound)).toBe(true);
    expect(hasSwitchLanguageBinding(specWith(structuredClone(ES_EN)))).toBe(
      false,
    );
  });

  it("appends alongside existing change bindings instead of clobbering", () => {
    const spec = specWith(structuredClone(ES_EN));
    (
      spec.elements as Record<
        string,
        { on: Record<string, unknown>; props: Record<string, unknown> }
      >
    )["lang-toggle"].on = {
      change: [{ action: "other" }],
      click: [{ action: "track" }],
    };
    const toggle = (
      withSwitchLanguageBinding(spec).elements as unknown as Record<
        string,
        { on: { change: unknown[]; click: unknown } }
      >
    )["lang-toggle"];
    expect(toggle.on.change).toHaveLength(2);
    expect(toggle.on.change[0]).toEqual({ action: "other" });
    expect(toggle.on.change[1]).toEqual({
      action: SWITCH_LANGUAGE_ACTION,
      params: { tag: { $state: "/locale" } },
    });
    expect(toggle.on.click).toEqual([{ action: "track" }]);
  });

  it("accepts the single-binding change shape and then no-ops", () => {
    const spec = specWith(structuredClone(ES_EN));
    (
      spec.elements as Record<
        string,
        { props: Record<string, unknown>; on: Record<string, unknown> }
      >
    )["lang-toggle"].on = {
      change: { action: SWITCH_LANGUAGE_ACTION },
    };
    expect(hasSwitchLanguageBinding(spec)).toBe(true);
    expect(withSwitchLanguageBinding(spec)).toBe(spec);
  });

  it("leaves specs without a switcher untouched", () => {
    const stepper = {
      root: "page",
      state: { locale: "en", copy: {} },
      elements: {
        toggle: {
          type: "ButtonGroup",
          props: {
            buttons: [
              { label: "JA", value: "ja" },
              { label: "KO", value: "ko" },
            ],
          },
          children: [],
        },
      },
    } as unknown as AnySpec;
    expect(withSwitchLanguageBinding(stepper)).toBe(stepper);
    const bare = {
      root: "page",
      state: { locale: "en", copy: {} },
    } as unknown as AnySpec;
    expect(withSwitchLanguageBinding(bare)).toBe(bare);
  });
});
