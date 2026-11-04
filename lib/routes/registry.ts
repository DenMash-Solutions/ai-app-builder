import { APP_SEGMENTS } from "@/lib/i18n/routing";
import { isValidSlug, isReservedSlug } from "@/lib/slug";

/**
 * The one namespace registry for the shared `/{locale}/{value}` space (plan
 * 069, implementing 062 decision 1). Every surface that decides "what does
 * this segment mean" goes through here: the publish claim, the live project
 * route and the owner's preview.
 *
 * Precedence (062 decision 1):
 *
 *   app segment > /user (profiles) > claimed project handle > published
 *   screen slug > local entry (preview only)
 *
 * Two surfaces, one order: the *live* surface cannot see local entries, so
 * `resolveLiveOwner` skips that rung. `resolvePreviewOwner` puts the owner's
 * local entry ahead of the *claims* — 061/065's "owner preview wins" — which
 * is the documented preview-only exception, not a second precedence. The
 * reserved rung stays first on BOTH surfaces: an app segment is a fact about
 * the URL space, not a claim, so a local entry named "admin" can never
 * outrank `/admin` (062 decision 1's ordering, verbatim).
 *
 * Pure functions only: the caller supplies the claimed sets (DB rows, local
 * store) so this module never decides where truth lives.
 */

export const ROUTE_OWNERS = {
  appSegment: "appSegment",
  profile: "profile",
  projectHandle: "projectHandle",
  publishedSlug: "publishedSlug",
  localEntry: "localEntry",
} as const;

export type RouteOwner = (typeof ROUTE_OWNERS)[keyof typeof ROUTE_OWNERS];

/** `/user/<username>` — an app segment in `APP_SEGMENTS`, but a distinct rung:
 *  it owns exactly one shape while other app segments own their own trees. */
export const PROFILE_SEGMENT = "user";

export interface RouteNamespaceSources {
  /** Claimed project handles (`projects.handle`, published projects). */
  handles: readonly string[];
  /** Published screen slugs (`published_pages.slug`). */
  publishedSlugs: readonly string[];
  /** The viewer's local entries — preview surface only. */
  localSlugs?: readonly string[];
}

/** The static rung: reserved segments never belong to a claim. */
export function reservedRouteOwner(value: string): RouteOwner | null {
  if (value === PROFILE_SEGMENT) return ROUTE_OWNERS.profile;
  if ((APP_SEGMENTS as readonly string[]).includes(value)) {
    return ROUTE_OWNERS.appSegment;
  }
  return null;
}

/**
 * Can this value be claimed by a project handle at all? Shape and reserved
 * segments, checked before any request: the DB arbitrates *takenness*, this
 * arbitrates *eligibility* (068's `usernameIssue` split, same reasoning).
 */
export function isClaimableRoute(value: string): boolean {
  return isValidSlug(value) && reservedRouteOwner(value) === null;
}

/**
 * What a `route_claims` row means — the same three values the DB check
 * constraint allows (`route_claims_kind_check`). Screens and handles are
 * claimable kinds; `redirect` exists only as a row state the handle trigger
 * writes, never something a caller may ask `route_available` about.
 */
export const ROUTE_CLAIM_KINDS = {
  screen: "screen",
  handle: "handle",
  redirect: "redirect",
} as const;

export type RouteClaimKind =
  (typeof ROUTE_CLAIM_KINDS)[keyof typeof ROUTE_CLAIM_KINDS];

/** Claim kinds a client may probe for (`route_available`'s `p_kind`). */
export function isClaimableRouteKind(value: string): value is RouteClaimKind {
  return (
    value === ROUTE_CLAIM_KINDS.screen || value === ROUTE_CLAIM_KINDS.handle
  );
}

/** Precedence for the live surface (no local entries exist server-side). */
export function resolveLiveOwner(
  value: string,
  sources: RouteNamespaceSources,
): RouteOwner | null {
  const reserved = reservedRouteOwner(value);
  if (reserved) return reserved;
  if (sources.handles.includes(value)) return ROUTE_OWNERS.projectHandle;
  if (sources.publishedSlugs.includes(value)) {
    return ROUTE_OWNERS.publishedSlug;
  }
  return null;
}

/**
 * Precedence for the preview surface: the reserved rung still answers first
 * (a static segment is not a claim), then the owner's local entry wins over
 * every claim, because previewing your own device draft must never be
 * shadowed by a claim someone else holds (061-3 section A).
 */
export function resolvePreviewOwner(
  value: string,
  sources: RouteNamespaceSources,
): RouteOwner | null {
  const reserved = reservedRouteOwner(value);
  if (reserved) return reserved;
  if (sources.localSlugs?.includes(value)) return ROUTE_OWNERS.localEntry;
  return resolveLiveOwner(value, sources);
}

/**
 * Reserved segments a user must not be allowed to type into a handle field.
 * `isReservedSlug` (lib/slug.ts) is the same list, minus the `/user` segment
 * when that list lags — the registry is the surface that owns the route
 * meaning, so it also exposes the check it applies.
 */
export function isReservedRoute(value: string): boolean {
  return isReservedSlug(value) || reservedRouteOwner(value) !== null;
}
