import { describe, expect, test } from "bun:test";
import {
  availableLanguages,
  baseTag,
  canonicalizeTag,
  getCopy,
  mergeI18n,
  seedLocale,
} from "@/lib/i18n/spec-languages";

const baseState = {
  locale: "en",
  copy: { title: "Sign in", submit: "Continue" },
};

describe("canonicalizeTag", () => {
  test("canonicalizes case and region", () => {
    expect(canonicalizeTag("ES")).toBe("es");
    expect(canonicalizeTag("es-mx")).toBe("es-MX");
    expect(canonicalizeTag("en")).toBe("en");
  });

  test("rejects invalid tags", () => {
    expect(canonicalizeTag("")).toBeNull();
    expect(canonicalizeTag("not a tag")).toBeNull();
    expect(canonicalizeTag("!!!")).toBeNull();
  });
});

describe("baseTag", () => {
  test("primary subtag", () => {
    expect(baseTag("es-MX")).toBe("es");
    expect(baseTag("es")).toBe("es");
  });
});

describe("seedLocale", () => {
  test("canonicalized state.locale", () => {
    expect(seedLocale(baseState)).toBe("en");
    expect(seedLocale({ locale: "ES" })).toBe("es");
  });

  test("falls back to en when absent or invalid", () => {
    expect(seedLocale(undefined)).toBe("en");
    expect(seedLocale({})).toBe("en");
    expect(seedLocale({ locale: "not a tag" })).toBe("en");
  });
});

describe("mergeI18n", () => {
  test("exact tag overlays the seed, missing keys fall back", () => {
    const state = {
      ...baseState,
      i18n: { es: { title: "Iniciar sesión" } },
    };
    const merged = mergeI18n(state, "es") as Record<string, unknown>;
    expect(getCopy(merged)).toEqual({
      title: "Iniciar sesión",
      submit: "Continue",
    });
    expect(merged.locale).toBe("en");
  });

  test("regional tag falls back to the base language, then the seed", () => {
    const state = { ...baseState, i18n: { es: { title: "Título" } } };
    expect(getCopy(mergeI18n(state, "es-MX")).title).toBe("Título");
    expect(getCopy(mergeI18n(state, "es-MX")).submit).toBe("Continue");
  });

  test("exact tag beats the base language", () => {
    const state = {
      ...baseState,
      i18n: { es: { title: "Base" }, "es-MX": { title: "Regional" } },
    };
    expect(getCopy(mergeI18n(state, "es-MX")).title).toBe("Regional");
  });

  test("seed language layers are skipped — the seed wins", () => {
    const state = { ...baseState, i18n: { en: { title: "Override" } } };
    expect(getCopy(mergeI18n(state, "en")).title).toBe("Sign in");
    // …and a regional view of the seed language skips the base layer too.
    expect(getCopy(mergeI18n(state, "en-US")).title).toBe("Sign in");
  });

  test("invalid tag and missing i18n return the input unchanged", () => {
    expect(mergeI18n(baseState, "not a tag")).toBe(baseState);
    const noI18n = { locale: "en", copy: { a: "A" } };
    expect(mergeI18n(noI18n, "es")).toBe(noI18n);
  });

  test("specs without copy stay untouched", () => {
    const state = { locale: "en", auth: { email: "" } };
    expect(mergeI18n(state, "es")).toBe(state);
    expect(mergeI18n(undefined, "es")).toBeUndefined();
    expect(mergeI18n(null, "es")).toBeNull();
  });

  test("non-string layer values are ignored", () => {
    const state = {
      ...baseState,
      i18n: { es: { title: "Sí", submit: 42 as unknown as string } },
    };
    const merged = getCopy(mergeI18n(state, "es"));
    expect(merged.title).toBe("Sí");
    expect(merged.submit).toBe("Continue");
  });

  test("input state is never mutated", () => {
    const state = { ...baseState, i18n: { es: { title: "Sesión" } } };
    mergeI18n(state, "es");
    expect(state.copy.title).toBe("Sign in");
  });
});

describe("availableLanguages", () => {
  test("seed first, canonicalized i18n keys, no duplicates", () => {
    const spec = {
      root: "a",
      elements: {},
      state: { locale: "EN", i18n: { ES: { a: "A" }, fr: { b: "B" }, en: {} } },
    };
    expect(availableLanguages(spec)).toEqual(["en", "es", "fr"]);
  });

  test("invalid keys dropped; no i18n → just the seed", () => {
    const spec = { root: "a", elements: {}, state: { copy: { a: "A" } } };
    expect(availableLanguages(spec)).toEqual(["en"]);
    const withBad = {
      root: "a",
      elements: {},
      state: { copy: {}, i18n: { "not a tag": {} } },
    };
    expect(availableLanguages(withBad)).toEqual(["en"]);
  });
});
