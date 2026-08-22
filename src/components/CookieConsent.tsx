import { Cookie, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

const CONSENT_KEY = "tubify_cookie_consent";
const LEGACY_CONSENT_KEY = "yroos.cookieConsent";
const CONSENT_VERSION = 1;

type ConsentRecord = { status: "all" | "essential"; version: number };

export function CookieConsent() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONSENT_KEY);
      const record = stored ? JSON.parse(stored) as Partial<ConsentRecord> : null;
      if (record?.version === CONSENT_VERSION && (record.status === "all" || record.status === "essential")) {
        setVisible(false);
      } else {
        // Preserve decisions made by the previous implementation without keeping its key as the source of truth.
        const legacy = window.localStorage.getItem(LEGACY_CONSENT_KEY);
        if (legacy === '"all"' || legacy === '"essential"') {
          const status = JSON.parse(legacy) as ConsentRecord["status"];
          window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ status, version: CONSENT_VERSION }));
          setVisible(false);
        } else {
          setVisible(true);
        }
      }
    } catch {
      setVisible(true);
    } finally {
      setReady(true);
    }
  }, []);

  const saveConsent = (status: ConsentRecord["status"]) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ status, version: CONSENT_VERSION }));
    } finally {
      setVisible(false);
    }
  };

  if (!ready || !visible) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[100] w-[calc(100%-2rem)] max-w-md sm:bottom-6 sm:left-6">
      <div
        className="relative rounded-2xl border border-white/10 p-6 text-white shadow-2xl sm:p-8"
        style={{ background: "radial-gradient(circle at 22% 20%, color-mix(in srgb, var(--primary) 35%, #0a1420) 0%, #0a1420 45%, #060b12 100%)" }}
      >
        <button
          onClick={() => saveConsent("essential")}
          aria-label="Close"
          className="absolute right-5 top-5 text-white/50 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Cookie className="h-7 w-7" />
        </span>

        <h2 className="mt-5 text-2xl font-bold tracking-tight">Cookie Preferences</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          We use cookies to improve your experience, understand how Tubify is used, and keep your session signed in. By clicking "Accept All", you agree to our use of cookies.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => saveConsent("all")}
            className="nav-glow-motion relative flex h-12 flex-1 items-center justify-center rounded-full bg-white px-6 text-sm font-bold uppercase tracking-wide text-[#0a1420] transition-transform hover:scale-[1.02]"
          >
            Accept All
          </button>
          <button
            onClick={() => saveConsent("essential")}
            className="flex h-12 flex-1 items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 text-sm font-bold uppercase tracking-wide text-white hover:bg-white/10"
          >
            Essential Only
          </button>
        </div>

        <p className="mt-5 flex items-center gap-1.5 text-xs text-white/40">
          <ShieldCheck className="h-3.5 w-3.5" /> Your privacy is our priority
        </p>
      </div>
    </div>
  );
}
