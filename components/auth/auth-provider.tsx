"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type UserRole = "user" | "admin";

interface AuthContextValue {
  /** null while signed out — `loading` distinguishes "unknown yet" from "anonymous". */
  user: User | null;
  role: UserRole | null;
  loading: boolean;
  /** Ends the Supabase session (local history is never touched). */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

/**
 * Session + role provider. The session itself is refreshed by the proxy on
 * every request; this hook surfaces it to the client tree (and keeps it in
 * sync via onAuthStateChange — sign-in/out propagate without a reload).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (!nextUser) setRole(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Role lives in `profiles` (RLS: readable by its owner). Fetched outside the
  // auth callback to avoid blocking the auth state machine.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setRole(data?.role === "admin" ? "admin" : "user");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  const signOut = useCallback(async () => {
    // Session only — local history lives in this browser and is never
    // deleted on sign-out (shared machines keep their drafts).
    await supabase.auth.signOut();
  }, [supabase]);

  const value = useMemo(
    () => ({ user, role, loading, signOut }),
    [user, role, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
