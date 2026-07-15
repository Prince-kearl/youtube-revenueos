import { useSyncExternalStore } from "react";

// Tiny reactive localStorage-backed store. Cross-component sync via subscribe().
type Listener = () => void;
const listeners: Record<string, Set<Listener>> = {};
const memory: Record<string, unknown> = {};

function read<T>(key: string, fallback: T): T {
  if (memory[key] !== undefined) return memory[key] as T;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) {
      memory[key] = fallback;
      return fallback;
    }
    const parsed = JSON.parse(raw) as T;
    memory[key] = parsed;
    return parsed;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  memory[key] = value;
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* quota errors: keep in-memory only */
  }
  listeners[key]?.forEach((l) => l());
}

export function useLocalStore<T>(key: string, initial: T): [T, (updater: T | ((prev: T) => T)) => void] {
  const subscribe = (cb: Listener) => {
    listeners[key] ??= new Set();
    listeners[key].add(cb);
    return () => listeners[key].delete(cb);
  };
  const getSnapshot = () => read<T>(key, initial);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);
  const setValue = (updater: T | ((prev: T) => T)) => {
    const next =
      typeof updater === "function"
        ? (updater as (prev: T) => T)(read<T>(key, initial))
        : updater;
    write(key, next);
  };
  return [value, setValue];
}

export function readStore<T>(key: string, fallback: T): T {
  return read(key, fallback);
}

export function writeStore<T>(key: string, value: T) {
  write(key, value);
}

export function clearAllStores(prefix = "yroos.") {
  if (typeof window === "undefined") return;
  Object.keys({ ...window.localStorage }).forEach((k) => {
    if (k.startsWith(prefix)) window.localStorage.removeItem(k);
  });
  Object.keys(memory).forEach((k) => {
    if (k.startsWith(prefix)) delete memory[k];
  });
  Object.keys(listeners).forEach((k) => listeners[k].forEach((l) => l()));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
