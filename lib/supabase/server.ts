import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { projectionRestFetch } from "@/lib/supabase/projection-cache";

/**
 * Server-side Supabase client for Server Components and Route Handlers.
 * Next 16: `cookies()` is async.
 *
 * The world-readable projection GETs are share-cached through
 * `projectionRestFetch` (plan 055 C); everything else is passthrough.
 */
/**
 * Cookie-free anon client for the world-readable projection reads (plan 056
 * F1). `getFeaturedPage`/`getPublishedPageBySlug` never depend on the
 * viewer's session — RLS makes them world-readable and cookies only widen
 * writes — so they must not touch `next/headers`' `cookies()`: that is
 * request-time runtime data, which blocks the static shell under Cache
 * Components (`blocking-prerender-runtime`). Same projection share-cache as
 * `createClient` (plan 055 C).
 */
export function createPublicReadClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
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

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes instead.
          }
        },
      },
      global: {
        fetch: projectionRestFetch,
      },
    },
  );
}
