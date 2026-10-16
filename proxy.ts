import createMiddleware from "next-intl/middleware";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { APP_SEGMENTS, routing } from "@/lib/i18n/routing";
import { updateSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  // Content paths lead with a tag that is neither an app locale nor an app
  // path segment: /{tag}/{slug} (decision 11) and the bare /{tag} root / slug
  // candidate (decision 12). next-intl routing would rewrite those into a
  // prefixed (or dead three-segment) URL, so pass them through untouched —
  // the [locale] tree serves, redirects (published slug), or 404s. App path
  // segments (e.g. the unprefixed deep link /ui/{ref}) and every other path
  // keep the usual prefix/redirect handling.
  const [first] = request.nextUrl.pathname.split("/").filter(Boolean);
  const isContentPath =
    first !== undefined &&
    !hasLocale(routing.locales, first) &&
    !(APP_SEGMENTS as readonly string[]).includes(first);
  const response = isContentPath
    ? NextResponse.next()
    : handleI18nRouting(request);
  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
