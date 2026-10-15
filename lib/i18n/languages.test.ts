import { describe, expect, it } from "bun:test";
import { canonicalizeTag } from "./spec-languages";
import {
  customLanguageTag,
  filterLanguages,
  LANGUAGE_TAGS,
  languageName,
  listLanguages,
} from "./languages";

describe("LANGUAGE_TAGS catalog", () => {
  it("is de-duplicated and every tag is a valid BCP-47 tag", () => {
    expect(new Set(LANGUAGE_TAGS).size).toBe(LANGUAGE_TAGS.length);
    for (const tag of LANGUAGE_TAGS) {
      expect(canonicalizeTag(tag)).toBe(tag);
    }
  });

  it("covers the whole ISO 639-1 registry plus common variants", () => {
    expect(LANGUAGE_TAGS.length).toBeGreaterThanOrEqual(175);
    for (const tag of [
      "zh",
      "fr",
      "ar",
      "hi",
      "sw",
      "yue",
      "pt-BR",
      "zh-Hans",
    ]) {
      expect(LANGUAGE_TAGS).toContain(tag);
    }
  });
});

describe("listLanguages", () => {
  it("names every tag in the locale and keeps the tag as fallback", () => {
    const options = listLanguages("en");
    expect(options.length).toBe(LANGUAGE_TAGS.length);
    for (const option of options) {
      expect(option.name.length).toBeGreaterThan(0);
    }
    // Names follow the app locale: zh reads differently in en vs es…
    const zhEn = options.find((o) => o.tag === "zh")?.name ?? "";
    const zhEs = listLanguages("es").find((o) => o.tag === "zh")?.name ?? "";
    expect(zhEn).not.toBe("zh");
    expect(zhEn).not.toBe(zhEs);
    // …and the Spanish name for zh is CLDR's "chino" (asserted loosely to
    // survive ICU minor-version drift).
    expect(zhEs.toLowerCase()).toContain("chin");
  });
});

describe("filterLanguages", () => {
  it("matches the localized name, so 'chino' finds zh in the Spanish UI", () => {
    expect(filterLanguages("chino", "es").map((o) => o.tag)).toContain("zh");
    // Accent-folded: 'frances' matches 'francés'.
    expect(filterLanguages("frances", "es").map((o) => o.tag)).toContain("fr");
    expect(filterLanguages("French", "en").map((o) => o.tag)).toContain("fr");
  });

  it("matches the tag case-insensitively, including variants", () => {
    expect(filterLanguages("pt-br", "en").map((o) => o.tag)).toContain("pt-BR");
    const frFamily = filterLanguages("fr", "en").map((o) => o.tag);
    expect(frFamily).toContain("fr");
    expect(frFamily).toContain("fr-CA");
  });

  it("returns everything for an empty query and nothing for junk", () => {
    expect(filterLanguages("", "en").length).toBe(LANGUAGE_TAGS.length);
    expect(filterLanguages("!!!", "en")).toEqual([]);
  });
});

describe("languageName + customLanguageTag", () => {
  it("languageName falls back to null instead of echoing the tag", () => {
    expect(languageName("zh", "en")).not.toBeNull();
    expect(languageName("zhzz-bogus", "en")).toBeNull();
  });

  it("accepts real codes and rejects bare long words", () => {
    expect(customLanguageTag("pt-br")).toBe("pt-BR");
    expect(customLanguageTag("zh-Hans")).toBe("zh-Hans");
    expect(customLanguageTag("yue")).toBe("yue");
    expect(customLanguageTag("tlh")).toBe("tlh");
    // Bare 5–8 letter words ARE syntactically valid BCP-47 primaries, but
    // they are reserved and never real languages — the picker must not
    // offer "chino" (the Spanish word) as an addable language (found via
    // MCP browser check, 2026-10-14).
    expect(customLanguageTag("chino")).toBeNull();
    expect(customLanguageTag("french")).toBeNull();
    expect(customLanguageTag("not a tag!!")).toBeNull();
    expect(customLanguageTag("")).toBeNull();
  });
});
