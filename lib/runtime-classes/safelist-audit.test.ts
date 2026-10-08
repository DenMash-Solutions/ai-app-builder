import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildForCandidates } from "./compile";
import { expandGlobalSafelist, extractInlineSources } from "./safelist";

const globalsCss = readFileSync(
  path.join(process.cwd(), "app/globals.css"),
  "utf8",
);

describe("app/globals.css @source inline safelist audit", () => {
  test("extraction sanity floors (guards against regex rot)", () => {
    expect(extractInlineSources(globalsCss).length).toBeGreaterThanOrEqual(17);
    expect(expandGlobalSafelist(globalsCss).length).toBeGreaterThanOrEqual(
      2000,
    );
  });

  test("every safelist candidate compiles a rule in the real engine", async () => {
    const candidates = expandGlobalSafelist(globalsCss);
    const { missing } = await buildForCandidates(candidates);
    expect(missing.slice(0, 50)).toEqual([]);
  }, 30000);
});
