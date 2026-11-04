import type { SupabaseClient } from "@supabase/supabase-js";
import { USERNAME_ISSUES, type UsernameIssue } from "@/lib/usernames";

/**
 * Client-side access to the two username RPCs (plan 068). Claims go through
 * Postgres functions rather than table writes because `profiles` has no write
 * policy at all — see `db/03_rls.sql`.
 */

export const USERNAME_RPCS = {
  claim: "claim_username",
  available: "username_available",
} as const;

/** Postgres SQLSTATEs the claim can surface: the unique index on a race, and
 *  the shape CHECK if a caller ever bypasses `checkUsername`. */
const PG_ERRORS = {
  uniqueViolation: "23505",
  checkViolation: "23514",
} as const;

type RpcError = { code?: string | null } | null;

/** Turns a failed claim into the user-facing reason, or null when the cause is
 *  not a username problem (network, session, server). */
export function claimIssue(error: RpcError): UsernameIssue | null {
  if (!error) return null;
  if (error.code === PG_ERRORS.uniqueViolation) return USERNAME_ISSUES.taken;
  if (error.code === PG_ERRORS.checkViolation) return USERNAME_ISSUES.pattern;
  return null;
}

/**
 * Advisory availability check for the typing UI. `null` means "could not
 * ask" — callers must not treat that as available; the claim is the only
 * authority either way.
 */
export async function fetchUsernameAvailable(
  supabase: SupabaseClient,
  username: string,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc(USERNAME_RPCS.available, {
    p_username: username,
  });
  if (error) return null;
  return data === true;
}

export type ClaimResult =
  { ok: true; username: string } | { ok: false; issue: UsernameIssue | null };

/** Claims the handle for the signed-in user; the server derives the owner
 *  from the session. `issue: null` on failure means "show the generic error". */
export async function claimUsername(
  supabase: SupabaseClient,
  username: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc(USERNAME_RPCS.claim, {
    p_username: username,
  });
  if (error) return { ok: false, issue: claimIssue(error) };
  return { ok: true, username: typeof data === "string" ? data : username };
}
