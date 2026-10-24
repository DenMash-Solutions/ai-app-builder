import { describe, expect, test } from "bun:test";
import { DATA_SOURCE_RULES } from "./data-source-rules";

describe("DATA_SOURCE_RULES", () => {
  test("shows the three top-level block shapes with worked examples", () => {
    expect(DATA_SOURCE_RULES).toContain('"dataSources": { "apiSource"');
    expect(DATA_SOURCE_RULES).toContain('"resources": { "items"');
    expect(DATA_SOURCE_RULES).toContain('"queries": { "itemsQuery"');
    expect(DATA_SOURCE_RULES).toContain("TOP-LEVEL spec blocks");
  });

  test("examples are generic — no test-target or domain leakage (053 D7)", () => {
    // Leaking the verification target's shapes (host, ref, domain nouns)
    // would make the live generation test circular, and every unrelated
    // generation shares this system prompt.
    for (const banned of [
      "pokemon",
      "pokedex",
      "pokeapi",
      "localhost",
      "4100",
      "heightM",
      "weightKg",
      "Bulbasaur",
    ]) {
      expect(DATA_SOURCE_RULES.toLowerCase()).not.toContain(banned);
    }
  });

  test("derives the zod descriptions (prompt and runtime cannot drift)", () => {
    for (const fragment of [
      'type": "bearer"', // provider/config auth teaching
      "storageKeyPrefix", // config describe
      'title": "string"', // resource schema describe
      '"list" returns every record', // operation describe
      "?offset=page×limit", // pageParam describe
      "/records/{id}", // itemDetail example in the config describe
    ]) {
      expect(DATA_SOURCE_RULES).toContain(fragment);
    }
    // Every derived description rendered (no schema dropped its .describe()).
    expect(DATA_SOURCE_RULES).not.toContain("undefined");
  });

  test("pins params/pagination to the query declaration (053 gap 3)", () => {
    expect(DATA_SOURCE_RULES).toContain("ONLY on the query declaration");
    expect(DATA_SOURCE_RULES).toContain("never inside an element's `repeat`");
    expect(DATA_SOURCE_RULES).toContain('entire input is `{ "query"');
  });

  test("itemsPath/totalPath are RESPONSE pointers, not request paths", () => {
    // Live failure (gen 1e9a13da): the rule said "every REQUEST path" and
    // the model filled itemsPath with the request URL path — pickPointer
    // found no array → DataError → error alert on a 200 response.
    expect(DATA_SOURCE_RULES).toContain("INTO THE RESPONSE");
    expect(DATA_SOURCE_RULES).toContain("NOT request paths");
    expect(DATA_SOURCE_RULES).toContain('itemsPath: "/results"');
    expect(DATA_SOURCE_RULES).toContain("NEVER the request URL path");
    expect(DATA_SOURCE_RULES).toContain("itemDetail.path` is a REQUEST path");
    expect(DATA_SOURCE_RULES).toContain('`"results"` fails validation');
  });

  test("teaches the page-state watcher (053 follow-up)", () => {
    // Without watch, Next/Prev setState /page but nothing refetches.
    expect(DATA_SOURCE_RULES).toContain('"watch": { "/page"');
    expect(DATA_SOURCE_RULES).toContain("the refetch");
    expect(DATA_SOURCE_RULES).toContain("never reloads");
  });

  test("teaches the complete stepPage args incl. maxPage (053 gap 7)", () => {
    // Live failure (imported spec 14b59e37): the bullet said "use stepPage
    // with delta" but never listed the args — 3.5 Lite omitted maxPage, so
    // stepPage clamped against the 12 loaded rows (ceiling = page 0) and
    // Next silently never advanced.
    expect(DATA_SOURCE_RULES).toContain("ALL FIVE args");
    expect(DATA_SOURCE_RULES).toContain(
      '"maxPage": { "$state": "/queries/<name>/maxPage" }',
    );
    expect(DATA_SOURCE_RULES).toContain("is REQUIRED: without it");
    expect(DATA_SOURCE_RULES).toContain("clamps against the rows you");
    expect(DATA_SOURCE_RULES).toContain("pagination silently does nothing");
  });

  test("teaches spec completeness — children must be defined (053 follow-up)", () => {
    // Live failure (gen 1e9a13da): pagination-bar referenced prev-btn and
    // next-btn that were never emitted → dangling refs, no buttons.
    expect(DATA_SOURCE_RULES).toContain("COMPLETENESS");
    expect(DATA_SOURCE_RULES).toContain("matching element defined");
    expect(DATA_SOURCE_RULES).toContain("referenced-but-missing");
  });

  test("declares urlSync as a top-level array for every paged spec", () => {
    expect(DATA_SOURCE_RULES).toContain('"urlSync": ["page", "limit"]');
    expect(DATA_SOURCE_RULES).toContain("TOP-LEVEL array");
    expect(DATA_SOURCE_RULES).toContain("EVERY paged spec declares it");
  });

  test("teaches schema semantics: optional, read-validating, primitives only (053 gap 5)", () => {
    expect(DATA_SOURCE_RULES).toContain("schema` is OPTIONAL");
    expect(DATA_SOURCE_RULES).toContain("validates EVERY read row");
    expect(DATA_SOURCE_RULES).toContain("no array type");
    expect(DATA_SOURCE_RULES).toContain(
      "one missing or mistyped declared field fails",
    );
    expect(DATA_SOURCE_RULES).toContain("declaring no schema at all is always");
  });

  test("teaches auth routing + shape-only refs (053 gap 1)", () => {
    expect(DATA_SOURCE_RULES).toContain("injects the deployment-held key");
    expect(DATA_SOURCE_RULES).toContain("WITHOUT `auth` the browser");
    expect(DATA_SOURCE_RULES).toContain("protected APIs answer 401");
    expect(DATA_SOURCE_RULES).toContain("SHAPE\n  ONLY");
    expect(DATA_SOURCE_RULES).toContain(
      '{ "type": "header", "header": "X-API-Key"',
    );
  });

  test("states the 0-based page convention (053 gap 4)", () => {
    expect(DATA_SOURCE_RULES).toContain('"state": { "page": 0, "limit": 20 }');
    expect(DATA_SOURCE_RULES).toContain("`/page` is 0-BASED");
    expect(DATA_SOURCE_RULES).toContain("URL `?page=2` ↔ state `1`");
  });
});
