import { getSupabaseBrowserClient } from "./browser";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";

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
  if (IS_LOCAL_DEMO) return Promise.resolve({ error: null });
  return getSupabaseBrowserClient().auth.signOut();
}

export function requestPasswordReset(email: string) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${currentOrigin()}/reset-password`,
  });
}

export function updatePassword(password: string) {
  return getSupabaseBrowserClient().auth.updateUser({ password });
}

export function listMfaFactors() {
  return getSupabaseBrowserClient().auth.mfa.listFactors();
}

export function enrollTotpFactor(friendlyName: string) {
  return getSupabaseBrowserClient().auth.mfa.enroll({ factorType: "totp", friendlyName });
}

export function challengeMfaFactor(factorId: string) {
  return getSupabaseBrowserClient().auth.mfa.challenge({ factorId });
}

export function verifyMfaFactor(factorId: string, challengeId: string, code: string) {
  return getSupabaseBrowserClient().auth.mfa.verify({ factorId, challengeId, code });
}

export function unenrollMfaFactor(factorId: string) {
  return getSupabaseBrowserClient().auth.mfa.unenroll({ factorId });
}

export function getMfaAssuranceLevel() {
  return getSupabaseBrowserClient().auth.mfa.getAuthenticatorAssuranceLevel();
}
