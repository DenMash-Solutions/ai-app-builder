import { describe, expect, test } from "bun:test";
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  isReservedSlug,
  isValidSlug,
  slugify,
  uniqueSlugFrom,
} from "./slug";

describe("slugify", () => {
  test("lowercases, hyphenates, and trims", () => {
    expect(slugify("  Clinical Dental Sonrisas  ")).toBe(
      "clinical-dental-sonrisas",
    );
  });

  test("strips diacritics", () => {
    expect(slugify("Clínica Dental Sonrisas")).toBe("clinica-dental-sonrisas");
    expect(slugify("Señor Muñoz")).toBe("senor-munoz");
  });

  test("collapses punctuation runs to single hyphens", () => {
    expect(slugify("Hello,   World!! Foo&Bar")).toBe("hello-world-foo-bar");
  });

  test("caps length without a trailing hyphen", () => {
    const slug = slugify("a".repeat(30) + " " + "b".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("empty and symbol-only input slugifies to empty", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("isValidSlug", () => {
  test("accepts lowercase hyphenated slugs", () => {
    expect(isValidSlug("dental-sonrisas")).toBe(true);
    expect(isValidSlug("ui-abc123")).toBe(true);
  });

  test("rejects uppercase, spaces, leading/trailing hyphens, empty", () => {
    expect(isValidSlug("Dental-Sonrisas")).toBe(false);
    expect(isValidSlug("dental sonrisas")).toBe(false);
    expect(isValidSlug("-dental")).toBe(false);
    expect(isValidSlug("dental-")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("isReservedSlug", () => {
  test("reserves the static route segments", () => {
    expect(isReservedSlug(RESERVED_SLUGS.ui)).toBe(true);
    expect(isReservedSlug(RESERVED_SLUGS.admin)).toBe(true);
    expect(isReservedSlug(RESERVED_SLUGS.login)).toBe(true);
    expect(isReservedSlug(RESERVED_SLUGS.signup)).toBe(true);
    expect(isReservedSlug("dental-sonrisas")).toBe(false);
  });
});

describe("uniqueSlugFrom", () => {
  const ID = "a1b2c3d4-e5f6-4789-abcd-ef0123456789";

  test("slugifies the name and appends a short id tail", () => {
    expect(uniqueSlugFrom("Clinical Dental Sonrisas", ID)).toBe(
      "clinical-dental-sonrisas-a1b2c3d4",
    );
  });

  test("falls back to the ui base when the name has no slug content", () => {
    expect(uniqueSlugFrom("!!!", ID)).toBe("ui-a1b2c3d4");
  });

  test("truncates long names so the tail still fits", () => {
    const slug = uniqueSlugFrom("word ".repeat(40), ID);
    expect(slug.length).toBeLessThanOrEqual(40 + 1 + 8);
    expect(slug.endsWith("-a1b2c3d4")).toBe(true);
  });
});
