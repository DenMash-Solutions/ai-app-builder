import createMiddleware from "next-intl/middleware";
import { hasLocale } from "next-intl";
import { NextResponse, type NextRequest } from "next/server";
import { APP_SEGMENTS, routing } from "@/lib/i18n/routing";
import { updateSession } from "@/lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  // Content-only locales reach only /{tag}/{slug} (decision 11). Once a path
  // leads with a non-app tag and has a slug to serve, i18n routing would
  // rewrite it to /{default}/{tag}/{slug} — a dead three-segment URL — so
  // pass it through untouched (the [locale] tree serves it or 404s). App
  // path segments (e.g. the unprefixed deep link /ui/{ref}) and every other
  // path keep the usual prefix/redirect handling.
  const [first, second] = request.nextUrl.pathname.split("/").filter(Boolean);
  const isContentPath =
    first !== undefined &&
    second !== undefined &&
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
