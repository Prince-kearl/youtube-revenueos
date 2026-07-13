import { useCallback, useEffect, useState } from "react";
import { channel as defaultChannel } from "@/lib/data";

export type ChannelSettings = {
  name: string;
  url: string;
  avatar: string;
  subscribers: string;
  showAvatar: boolean;
  showSubscribers: boolean;
  showRecentPosts: boolean;
  showVisitButton: boolean;
};

const STORAGE_KEY = "revenueos.channel-settings";

export const defaultChannelSettings: ChannelSettings = {
  name: defaultChannel.name,
  url: defaultChannel.url,
  avatar: defaultChannel.avatar,
  subscribers: defaultChannel.subscribers,
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

function emit() {
  listeners.forEach((l) => l());
}

export function useChannelSettings() {
  // Start from defaults for SSR/first paint, then hydrate from storage.
  const [settings, setSettings] = useState<ChannelSettings>(defaultChannelSettings);

  useEffect(() => {
    setSettings(read());
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
    } catch {
      /* ignore quota errors */
    }
    setSettings(next);
    emit();
  }, []);

  return { settings, update };
}
