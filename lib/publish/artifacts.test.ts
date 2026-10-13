import { describe, expect, test } from "bun:test";
import { lookupArtifact, parseArtifacts } from "./artifacts";

const artifact = (html: string, version = 1) => ({
  html,
  css: "",
  kind: "content" as const,
  version,
});

describe("parseArtifacts", () => {
  test("canonicalizes tags and drops malformed entries", () => {
    const parsed = parseArtifacts({
      ES: artifact("hola"),
      fr: { html: "bonjour", css: "", kind: "content", version: 2 },
      de: { notHtml: true },
      "not a tag": artifact("x"),
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["es", "fr"]);
    expect(parsed?.es.html).toBe("hola");
    expect(parsed?.fr.version).toBe(2);
  });

  test("null for non-objects and empty results", () => {
    expect(parseArtifacts(null)).toBeNull();
    expect(parseArtifacts([])).toBeNull();
    expect(parseArtifacts("x")).toBeNull();
    expect(parseArtifacts({ de: { notHtml: true } })).toBeNull();
  });
});

describe("lookupArtifact", () => {
  const artifacts = {
    en: artifact("english"),
    es: artifact("spanish"),
  };

  test("exact tag, then base language, then seed", () => {
    expect(lookupArtifact(artifacts, "es", "en")?.html).toBe("spanish");
    expect(lookupArtifact(artifacts, "es-MX", "en")?.html).toBe("spanish");
    expect(lookupArtifact(artifacts, "en", "en")?.html).toBe("english");
  });

  test("a locale without an artifact falls back to the seed", () => {
    expect(lookupArtifact(artifacts, "fr", "en")?.html).toBe("english");
    expect(lookupArtifact(artifacts, "pt-BR", "en")?.html).toBe("english");
  });

  test("null when nothing is baked", () => {
    expect(lookupArtifact(null, "es", "en")).toBeNull();
    expect(lookupArtifact({}, "es", "en")).toBeNull();
  });
});
