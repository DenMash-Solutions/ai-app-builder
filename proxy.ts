import createMiddleware from "next-intl/middleware";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { APP_SEGMENTS, routing } from "@/lib/i18n/routing";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";
import {
  getFeaturedLanguagesFrom,
  publishedSlugExistsFrom,
} from "@/lib/publish/featured";
import { resolveRootServing } from "@/lib/publish/root-serving";
import { createProxyReadClient, updateSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

/**
 * Decision 12 (serve / 307 / 404) for a bare single content segment.
 *
 * Under Cache Components every dynamic route streams a static shell first,
 * so the status is committed at 200 before the root page's
 * `notFound()`/`redirect()` fire (production regression, plan 056: bare
 * unknowns soft-404ed, published slugs lost their 307) — the framework
 * prescribes exactly this move: "run that check in proxy" (`loading.md`
 * Status Codes, `not-found.md`). Two-segment content paths keep their
 * page-level gates (they already return real statuses / are content by
 * design). Returns `null` when the route should render normally.
 */
async function bareSegmentResponse(
  request: NextRequest,
  first: string,
  second: string | undefined,
): Promise<NextResponse | null> {
  if (first === undefined || second !== undefined) return null;
  const supabase = createProxyReadClient(request);
  // Both lookups start together (the proxy bypasses the RSC data cache, so
  // roundtrips dominate); the decision ORDER stays resolveRootServing's.
  const slugExists = publishedSlugExistsFrom(supabase, first);
  const carried = await getFeaturedLanguagesFrom(supabase);
  const serving = await resolveRootServing(first, carried, () => slugExists);
  if (serving === "redirect") {
    return NextResponse.redirect(
      new URL(`/${routing.defaultLocale}/${first}`, request.url),
    );
  }
  if (serving === "not-found") {
    // Prerendered Next 404 route — real status + the default not-found UI.
    return NextResponse.rewrite(new URL("/_not-found", request.url));
  }
  return null;
}

export async function proxy(request: NextRequest) {
  // Content paths lead with a tag that is neither an app locale nor an app
  // path segment: /{tag}/{slug} (decision 11) and the bare /{tag} root / slug
  // candidate (decision 12). next-intl routing would rewrite those into a
  // prefixed (or dead three-segment) URL, so pass them through untouched —
  // the [locale] tree serves, and the bare case is decided right here (see
  // bareSegmentResponse). App path segments (e.g. the unprefixed deep link
  // /ui/{ref}) and every other path keep the usual prefix/redirect handling.
  const [first, second] = request.nextUrl.pathname.split("/").filter(Boolean);
  const isContentPath =
    first !== undefined &&
    !hasLocale(routing.locales, first) &&
    !(APP_SEGMENTS as readonly string[]).includes(first);
  if (isContentPath && second !== undefined) {
    // Decision 11/12 status decisions for content paths, all pure CPU here
    // (no DB): (1) a non-canonical tag can't render — decide it before any
    // body streams (`loading.md` Status Codes: "ensure the resource exists
    // before the response body is streamed"), exactly like
    // bareSegmentResponse below; under Cache Components a `notFound()`
    // inside a streamed subtree commits 200 first (the soft-404 plan 056
    // already fixed once). (2) App surfaces (ui/admin/login/signup) serve
    // the app languages only — this is `(app)/layout`'s locale gate moved
    // here: the parent's `notFound()` threw during validation's prefetch
    // render and poisoned every child segment's validation, and the status
    // belongs upstream anyway. The [locale]/[slug] page keeps its
    // canonical-tag gate as defense for dot-paths, which this matcher
    // excludes (`.*\..*`) and therefore never reach this guard.
    if (
      canonicalizeTag(first) === null ||
      (APP_SEGMENTS as readonly string[]).includes(second)
    ) {
      return NextResponse.rewrite(new URL("/_not-found", request.url));
    }
  }
  const response = isContentPath
    ? ((await bareSegmentResponse(request, first, second)) ??
      NextResponse.next())
    : handleI18nRouting(request);
  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
