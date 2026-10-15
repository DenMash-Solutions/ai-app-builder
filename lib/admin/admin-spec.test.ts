import { describe, expect, test } from "bun:test";
import { validateSpec } from "@json-render/core";
import type { Spec } from "@json-render/core";
import adminSpecJson from "@/lib/specs/admin.spec.json";
import { buildAdminSpec } from "./admin-spec";
import type { AdminPageSummary, AdminSpecCopy } from "./admin-spec";

const baseSpec = adminSpecJson as unknown as Spec;

const COPY: AdminSpecCopy = {
  openLive: "Open live page",
  feature: "Feature as root",
  unfeature: "Remove from root",
  featuredBadge: "Featured on /",
};

const PAGES: AdminPageSummary[] = [
  {
    uiId: "ui-a",
    name: "Dental",
    slug: "dental",
    version: 2,
    ownerEmail: "mario@denmash.com",
    featured: true,
    languages: ["en", "es", "fr"],
  },
  {
    uiId: "ui-b",
    name: "SaaS",
    slug: "saas",
    version: 1,
    ownerEmail: null,
    featured: false,
    languages: ["en"],
  },
];

describe("buildAdminSpec", () => {
  const built = buildAdminSpec(baseSpec, PAGES, "es", COPY);

  test("stays structurally valid", () => {
    const { valid, issues } = validateSpec(built);
    expect(issues).toEqual([]);
    expect(valid).toBe(true);
  });

  test("appends one card per page and links them into the grid", () => {
    const cards = built.elements["cards"];
    expect(cards.children).toEqual(["ui-a-card", "ui-b-card"]);
    expect(built.elements["ui-a-card"].props).toMatchObject({
      title: "Dental",
      description: "mario@denmash.com · /dental · v2",
    });
    expect(built.elements["ui-b-card"].props).toMatchObject({
      title: "SaaS",
      description: "— · /saas · v1",
    });
  });

  test("derives per-page featured state and picks the matching action", () => {
    expect(built.state?.["admin"]).toMatchObject({
      empty: false,
      featured: { "ui-a": true, "ui-b": false },
      notFeatured: { "ui-a": false, "ui-b": true },
    });

    // Featured page offers "unfeature"; the other offers "feature".
    expect(built.elements["ui-a-unfeature"].on).toMatchObject({
      press: { action: "admin.unfeature", params: { uiId: "ui-a" } },
    });
    expect(built.elements["ui-a-feature"].visible).toEqual({
      $state: "/admin/notFeatured/ui-a",
    });
    expect(built.elements["ui-b-feature"].on).toMatchObject({
      press: { action: "admin.feature", params: { uiId: "ui-b" } },
    });
  });

  test("live links are locale-prefixed", () => {
    expect(built.elements["ui-b-live"].props).toMatchObject({
      href: "/es/saas",
    });
  });

  test("featured badge carries its label as a text prop (shadcn quirk)", () => {
    expect(built.elements["ui-a-badge"].props).toMatchObject({
      text: "Featured on /",
    });
    expect(built.elements["ui-b-badge"].visible).toEqual({
      $state: "/admin/featured/ui-b",
    });
  });

  test("coverage badges list every baked tag, uppercase, ahead of the actions", () => {
    expect(built.elements["ui-a-row"].children).toEqual([
      "ui-a-lang-0",
      "ui-a-lang-1",
      "ui-a-lang-2",
      "ui-a-badge",
      "ui-a-live",
      "ui-a-unfeature",
    ]);
    expect(built.elements["ui-a-lang-0"].props).toMatchObject({
      text: "EN",
      variant: "outline",
    });
    expect(built.elements["ui-a-lang-2"].props).toMatchObject({ text: "FR" });
    // A single-language page gets exactly one badge, never a stale gap.
    expect(built.elements["ui-b-row"].children?.slice(0, 2)).toEqual([
      "ui-b-lang-0",
      "ui-b-badge",
    ]);
    expect(built.elements["ui-b-lang-0"].props).toMatchObject({ text: "EN" });
  });

  test("empty overview keeps the frame and flags the empty state", () => {
    const empty = buildAdminSpec(baseSpec, [], "en", COPY);

    expect(empty.elements["cards"].children).toEqual([]);
    expect(empty.state?.["admin"]).toMatchObject({ empty: true });
  });
});
