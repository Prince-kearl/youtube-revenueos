import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./browser";
import { DEMO_USER, IS_LOCAL_DEMO } from "@/lib/demo-youtube";

interface AuthSessionState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

// Cookie-backed session (see browser.ts), so this naturally survives full page refreshes —
// getSession() below reads the cookie on mount instead of needing any extra rehydration step.
export function useAuthSession(): AuthSessionState {
  const [state, setState] = useState<AuthSessionState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    if (IS_LOCAL_DEMO) {
      setState({ session: null, user: DEMO_USER, loading: false });
      return;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!active) return;
      setState({ session: data.session, user: data.session?.user ?? null, loading: false });
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        if (!active) return;
        setState({ session, user: session?.user ?? null, loading: false });
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}
