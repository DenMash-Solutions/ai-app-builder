import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { projectionRestFetch } from "@/lib/supabase/projection-cache";

/**
 * Anon-key read client for the proxy (plan 056): the bare-segment
 * decision-12 reads (featured carried languages, published-slug existence)
 * need a Supabase client, but `next/headers`' `cookies()` is unavailable in
 * the proxy — so the client is built from the request's cookies directly,
 * with the same projection share-cache the RSC client uses. Read-only: no
 * auth call ever runs through it, so `setAll` never fires.
 */
export function createProxyReadClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Read-only client — nothing to persist.
        },
      },
      global: {
        fetch: projectionRestFetch,
      },
    },
  );
}

/**
 * Refreshes the Supabase auth session on every matched request (from the
 * proxy, before rendering). Mutates the request's cookies in place and copies
 * any refreshed tokens onto the outgoing response — the standard @supabase/ssr
 * proxy pattern.
 */
export async function updateSession(
  request: NextRequest,
  response: NextResponse,
) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the JWT against Supabase Auth — this is what
  // triggers a token refresh when the access token is expired.
  await supabase.auth.getUser();

  return response;
}
