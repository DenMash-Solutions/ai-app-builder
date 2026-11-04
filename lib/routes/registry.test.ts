import { describe, expect, test } from "bun:test";
import { APP_SEGMENTS } from "@/lib/i18n/routing";
import { RESERVED_SLUGS } from "@/lib/slug";
import {
  PROFILE_SEGMENT,
  ROUTE_CLAIM_KINDS,
  ROUTE_OWNERS,
  isClaimableRoute,
  isClaimableRouteKind,
  isReservedRoute,
  reservedRouteOwner,
  resolveLiveOwner,
  resolvePreviewOwner,
  type RouteNamespaceSources,
} from "./registry";

const VALUE = "acme-app";

/** Presence of each claimant for `value` — every pair and every tie. */
type Claimants = {
  handle?: boolean;
  slug?: boolean;
  local?: boolean;
};

function sources(claimants: Claimants, value = VALUE): RouteNamespaceSources {
  return {
    handles: claimants.handle ? [value] : [],
    publishedSlugs: claimants.slug ? [value] : [],
    localSlugs: claimants.local ? [value] : [],
  };
}

/** All 8 subsets of {handle, slug, local} — pairs, triples and no-claim. */
const ALL_COMBINATIONS: Claimants[] = [
  {},
  { handle: true },
  { slug: true },
  { local: true },
  { handle: true, slug: true },
  { handle: true, local: true },
  { slug: true, local: true },
  { handle: true, slug: true, local: true },
];

function expectedLive(c: Claimants) {
  if (c.handle) return ROUTE_OWNERS.projectHandle;
  if (c.slug) return ROUTE_OWNERS.publishedSlug;
  return null;
}

function expectedPreview(c: Claimants) {
  if (c.local) return ROUTE_OWNERS.localEntry;
  return expectedLive(c);
}

describe("precedence matrix (062 decision 1)", () => {
  test("live: every claimant combination resolves by handle > published slug", () => {
    for (const c of ALL_COMBINATIONS) {
      expect(resolveLiveOwner(VALUE, sources(c))).toEqual(expectedLive(c));
    }
  });

  test("preview: local entry outranks the claims, never the reserved rung", () => {
    for (const c of ALL_COMBINATIONS) {
      expect(resolvePreviewOwner(VALUE, sources(c))).toEqual(
        expectedPreview(c),
      );
    }
  });

  test("ties against a reserved segment lose on both surfaces", () => {
    const tied = { handle: true, slug: true, local: true } satisfies Claimants;
    for (const segment of APP_SEGMENTS) {
      const all = sources(tied, segment);
      const expected =
        segment === PROFILE_SEGMENT
          ? ROUTE_OWNERS.profile
          : ROUTE_OWNERS.appSegment;
      expect(reservedRouteOwner(segment)).toEqual(expected);
      expect(resolveLiveOwner(segment, all)).toEqual(expected);
      expect(resolvePreviewOwner(segment, all)).toEqual(expected);
    }
  });

  test("an unclaimed value resolves to nothing (real 404, no fallback)", () => {
    expect(resolveLiveOwner(VALUE, { handles: [], publishedSlugs: [] })).toBe(
      null,
    );
    expect(
      resolvePreviewOwner(VALUE, {
        handles: [],
        publishedSlugs: [],
        localSlugs: [],
      }),
    ).toBe(null);
  });

  test("a local entry only wins where the preview surface can see it", () => {
    const c: Claimants = { local: true };
    expect(resolvePreviewOwner(VALUE, sources(c))).toEqual(
      ROUTE_OWNERS.localEntry,
    );
    expect(resolveLiveOwner(VALUE, sources(c))).toBe(null);
  });
});

describe("isClaimableRoute", () => {
  test("accepts a shaped, unreserved value", () => {
    expect(isClaimableRoute(VALUE)).toBe(true);
    expect(isClaimableRoute("todo")).toBe(true);
  });

  test("rejects every reserved segment", () => {
    for (const segment of APP_SEGMENTS) {
      expect(isClaimableRoute(segment)).toBe(false);
    }
    for (const slug of Object.values(RESERVED_SLUGS)) {
      expect(isClaimableRoute(slug)).toBe(false);
    }
  });

  test("rejects shapes that are not slugs", () => {
    expect(isClaimableRoute("")).toBe(false);
    expect(isClaimableRoute("Acme")).toBe(false);
    expect(isClaimableRoute("acme app")).toBe(false);
    expect(isClaimableRoute("-acme")).toBe(false);
    expect(isClaimableRoute("acme-")).toBe(false);
    expect(isClaimableRoute(`a${"b".repeat(48)}`)).toBe(false);
  });
});

describe("isReservedRoute", () => {
  test("covers the static segments and the profile rung", () => {
    for (const segment of APP_SEGMENTS) {
      expect(isReservedRoute(segment)).toBe(true);
    }
    expect(isReservedRoute(PROFILE_SEGMENT)).toBe(true);
  });

  test("leaves claimable values alone", () => {
    for (const value of [VALUE, "todo", "069-release"]) {
      expect(isReservedRoute(value)).toBe(false);
      expect(isClaimableRoute(value)).toBe(true);
    }
  });
});

describe("claim kinds (decision 11 — the arbiter's p_kind)", () => {
  test("only screen and handle are probeable; redirect is a row state", () => {
    expect(isClaimableRouteKind(ROUTE_CLAIM_KINDS.screen)).toBe(true);
    expect(isClaimableRouteKind(ROUTE_CLAIM_KINDS.handle)).toBe(true);
    expect(isClaimableRouteKind(ROUTE_CLAIM_KINDS.redirect)).toBe(false);
  });

  test("rejects anything that is not one of the two kinds", () => {
    for (const value of ["", "Screen", "handles", "screen ", "redirects"]) {
      expect(isClaimableRouteKind(value)).toBe(false);
    }
  });
});
