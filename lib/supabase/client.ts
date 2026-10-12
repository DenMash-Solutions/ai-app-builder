import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. The anon/publishable key is a public client
 * key — security lives in RLS, not in hiding this value.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
