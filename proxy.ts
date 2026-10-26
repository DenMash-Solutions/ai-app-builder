import createMiddleware from "next-intl/middleware";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { APP_SEGMENTS, routing } from "@/lib/i18n/routing";
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
  const response = isContentPath
    ? ((await bareSegmentResponse(request, first, second)) ??
      NextResponse.next())
    : handleI18nRouting(request);
  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
