import { getSupabaseBrowserClient } from "./browser";
import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";

function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function signUpWithPassword(
  email: string,
  password: string,
  name: string,
  referredByCode?: string | null,
) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, ...(referredByCode ? { referred_by_code: referredByCode } : {}) },
      emailRedirectTo: `${currentOrigin()}/auth/callback`,
    },
  });
}

export function signInWithPassword(email: string, password: string) {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signInWithPassword({ email, password });
}

// Requesting the YouTube scopes here too (must match YOUTUBE_OAUTH_SCOPES in
// lib/server/google-oauth.ts) means signing in/up with Google is ALSO authorizing YouTube data
// access — one consent screen instead of a separate "Connect YouTube Channel" step afterward. See
// /auth/callback, which reads session.provider_token/provider_refresh_token to store the channel
// connection directly when they're present, falling back to the separate /api/youtube/auth flow
// (e.g. for email/password signups, which have no Google provider token at all) when they're not.
const YOUTUBE_SCOPES_FOR_SIGN_IN = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
].join(" ");

export function signInWithGoogle() {
  const supabase = getSupabaseBrowserClient();
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${currentOrigin()}/auth/callback`,
      scopes: YOUTUBE_SCOPES_FOR_SIGN_IN,
      // access_type=offline + prompt=consent is required to reliably get a refresh token back,
      // otherwise the connection would silently stop working once the access token expires.
      queryParams: { access_type: "offline", prompt: "consent" },
    },
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
