import { describe, expect, test } from "bun:test";
import {
  missingTranslationTags,
  validateSpecI18n,
} from "@/lib/i18n/spec-coverage";

const state = {
  locale: "en",
  copy: { title: "Sign in", submit: "Continue" },
};

describe("validateSpecI18n", () => {
  test("full coverage → nothing missing", () => {
    const report = validateSpecI18n({
      ...state,
      i18n: { es: { title: "Entrar", submit: "Continuar" } },
    });
    expect(report.seed).toBe("en");
    expect(report.copyKeys).toEqual(["title", "submit"]);
    expect(report.tags).toEqual([
      {
        tag: "es",
        valid: true,
        redundant: false,
        missing: [],
        orphaned: [],
      },
    ]);
  });

  test("per-tag diff: missing and orphaned keys", () => {
    const report = validateSpecI18n({
      ...state,
      i18n: { es: { title: "Entrar", stale: "viejo" } },
    });
    expect(report.tags[0].missing).toEqual(["submit"]);
    expect(report.tags[0].orphaned).toEqual(["stale"]);
  });

  test("tag-format check flags invalid keys", () => {
    const report = validateSpecI18n({ ...state, i18n: { "not a tag": {} } });
    expect(report.tags[0].valid).toBe(false);
    expect(report.tags[0].tag).toBe("not a tag");
  });

  test("seed-language layer is flagged redundant", () => {
    const report = validateSpecI18n({ ...state, i18n: { en: { title: "x" } } });
    expect(report.tags[0].redundant).toBe(true);
  });

  test("empty report for specs without i18n or copy", () => {
    expect(validateSpecI18n(undefined)).toEqual({
      seed: "en",
      copyKeys: [],
      tags: [],
    });
    expect(validateSpecI18n({ locale: "es" }).tags).toEqual([]);
  });
});

describe("missingTranslationTags", () => {
  test("valid non-redundant tags with gaps only", () => {
    const report = validateSpecI18n({
      ...state,
      i18n: {
        es: { title: "Entrar" },
        fr: {},
        en: { title: "x" },
        "bad tag": {},
      },
    });
    expect(missingTranslationTags(report)).toEqual(["es", "fr"]);
  });
});
