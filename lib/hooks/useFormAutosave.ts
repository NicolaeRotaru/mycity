'use client';

import { useEffect, useRef } from 'react';

/**
 * Autosave su localStorage (debounced). Pensato per la bozza del NUOVO
 * prodotto: se il venditore ricarica o esce, ritrova quanto stava scrivendo.
 *
 *   useFormAutosave(key, snapshot, { enabled });           // salva
 *   const restored = loadAutosave<Snapshot>(key);          // al mount
 *   clearAutosave(key);                                    // dopo il submit
 */
export function useFormAutosave<T>(
  key: string,
  value: T,
  opts?: { enabled?: boolean; delay?: number },
): void {
  const enabled = opts?.enabled ?? true;
  const delay = opts?.delay ?? 600;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota/Safari privata: ignora */
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, enabled, delay]);
}

export function loadAutosave<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
