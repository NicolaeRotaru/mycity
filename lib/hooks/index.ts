/**
 * Utility hooks primitive — single responsibility, testabili.
 *
 * Esperti: Staff Frontend Engineer: "Mai duplicare localStorage access,
 * debounce, media query, click outside, scroll position. Sono primitive."
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wrapper localStorage type-safe + SSR safe + cross-tab sync.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (val: T | ((prev: T) => T)) => void] {
  /**
   * 22/8/2026 — LEGGERE DAL BROWSER NELL'INIZIALIZZATORE ROMPE L'IDRATAZIONE.
   *
   * Il server disegna la pagina con `initial`, perché `window` non esiste. Il
   * browser al primo render legge il valore salvato e disegna qualcos'altro.
   * React trova due alberi diversi e, invece di aggiornare, ridisegna il ramo
   * da zero: sulla pillola «Consegna a…» questo si vedeva come un lampo, e
   * peggio ancora buttava via lo stato locale di chi stava scrivendo.
   *
   * Adesso il valore salvato entra DOPO il primo render, in un effetto: il
   * primo disegno del browser combacia con quello del server, e il valore
   * vero arriva un istante dopo senza rompere niente.
   */
  const [val, setVal] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setVal(JSON.parse(stored) as T);
    } catch {
      /* niente da leggere: si resta sul valore di partenza */
    }
    // La chiave non cambia nella vita del componente; se cambiasse, si rilegge.
  }, [key]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setVal((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch { /* QuotaExceededError ecc. */ }
        return next;
      });
    },
    [key],
  );

  // Cross-tab sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        setVal(JSON.parse(e.newValue) as T);
      } catch { /* invalid JSON in storage */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  return [val, set];
}

/**
 * Debounce un valore — utile per search input, filtri ad alto throughput.
 */
export function useDebounce<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Match a media query reactively.
 * Esempio: const isMobile = useMediaQuery('(max-width: 767px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 ha solo addListener
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // @ts-ignore legacy API
    mql.addListener(handler);
    // @ts-ignore legacy API
    return () => mql.removeListener(handler);
  }, [query]);
  return matches;
}

/**
 * Trigger callback on click outside del ref. Per dropdown, popover, ecc.
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T>,
  handler: (event: MouseEvent | TouchEvent) => void,
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el || el.contains(event.target as Node)) return;
      handler(event);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}

/**
 * Ref alla precedente valore di una variabile.
 * Utile per detect cambi di stato in useEffect.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
