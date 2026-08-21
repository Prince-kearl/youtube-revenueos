import { getSupabaseBrowserClient } from "./browser";

function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function signUpWithPassword(email: string, password: string, name: string) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${currentOrigin()}/auth/callback` },
  });
}

export function signInWithPassword(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signInWithPassword({ email, password });
}

export function signInWithGoogle() {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${currentOrigin()}/auth/callback` },
  });
}

export function signOutSupabase() {
  return getSupabaseBrowserClient().auth.signOut();
}

export function requestPasswordReset(email: string) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: `${currentOrigin()}/reset-password` });
}

export function updatePassword(password: string) {
  return getSupabaseBrowserClient().auth.updateUser({ password });
}
