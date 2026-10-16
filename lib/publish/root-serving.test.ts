import { describe, expect, it } from "bun:test";
import { resolveRootServing } from "@/lib/publish/root-serving";
import { routing } from "@/lib/i18n/routing";

const noLookup = async (): Promise<boolean> => {
  throw new Error("slug lookup must not run on serving paths");
};

describe("resolveRootServing", () => {
  it("serves app languages without a slug lookup", async () => {
    for (const locale of routing.locales) {
      expect(await resolveRootServing(locale, [], noLookup)).toBe("serve");
    }
  });

  it("serves a content-only language the featured design carries", async () => {
    expect(await resolveRootServing("fr", ["en", "es", "fr"], noLookup)).toBe(
      "serve",
    );
  });

  it("redirects an uncarried segment that is a published slug", async () => {
    const seen: string[] = [];
    const result = await resolveRootServing(
      "denmash",
      ["en", "es"],
      async (slug) => {
        seen.push(slug);
        return slug === "denmash";
      },
    );
    expect(result).toBe("redirect");
    expect(seen).toEqual(["denmash"]);
  });

  it("404s an uncarried segment that is nobody's slug", async () => {
    expect(
      await resolveRootServing("foo", ["en", "es"], async () => false),
    ).toBe("not-found");
  });
});
