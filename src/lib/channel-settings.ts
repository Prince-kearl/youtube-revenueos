import { useCallback, useEffect, useState } from "react";
export type ChannelSettings = {
  name: string;
  url: string;
  avatar: string;
  subscribers: string;
  showName: boolean;
  showAvatar: boolean;
  showSubscribers: boolean;
  showRecentPosts: boolean;
  showVisitButton: boolean;
};

const STORAGE_KEY = "revenueos.channel-settings";

export const defaultChannelSettings: ChannelSettings = {
  name: "",
  url: "",
  avatar: "",
  subscribers: "",
  showName: true,
  showAvatar: true,
  showSubscribers: true,
  showRecentPosts: true,
  showVisitButton: true,
};

function read(): ChannelSettings {
  if (typeof window === "undefined") return defaultChannelSettings;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultChannelSettings;
    return { ...defaultChannelSettings, ...JSON.parse(raw) };
  } catch {
    return defaultChannelSettings;
  }
}

const listeners = new Set<() => void>();

export function clearChannelSettings() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  emit();
}

function emit() {
  listeners.forEach((l) => l());
}

export function useChannelSettings() {
  // Start from defaults for SSR/first paint, then hydrate from storage.
  const [settings, setSettings] = useState<ChannelSettings>(defaultChannelSettings);

  useEffect(() => {
    setSettings(read());
    fetch("/api/profile")
      .then(async (response) => {
        const body = (await response.json()) as { data?: { banner_settings?: Partial<ChannelSettings> | null } };
        if (!response.ok || !body.data?.banner_settings) return;
        const next = { ...read(), ...body.data.banner_settings };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSettings(next);
      })
      .catch(() => undefined);
    const onChange = () => setSettings(read());
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const update = useCallback((patch: Partial<ChannelSettings>) => {
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      setSettings(next);
      emit();
      throw err;
    }
    setSettings(next);
    emit();
    void fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banner_settings: next }),
    }).catch(() => undefined);
  }, []);

  return { settings, update };
}
