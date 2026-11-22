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
  opts?: { enabled?: boolean; delay?: number; autore?: string | null },
): void {
  const enabled = opts?.enabled ?? true;
  const delay = opts?.delay ?? 600;
  // Con `autore` fra le opzioni la bozza si salva con l'id di chi la scrive, e finché quell'id non
  // si conosce non si salva niente.
  const conAutore = !!opts && 'autore' in opts;
  const autore = opts?.autore ?? null;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (conAutore && !autore) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        if (conAutore && autore) salvaBozzaDi(key, autore, value);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota/Safari privata: ignora */
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, enabled, delay, conAutore, autore]);
}

/** La bozza del nuovo prodotto (pagina «Nuovo prodotto», import da link). */
export const CHIAVE_BOZZA_NUOVO_PRODOTTO = 'mc_new_product_draft';

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

/**
 * LA BOZZA HA UN AUTORE. La memoria del browser è del dispositivo, non della persona: chi entra
 * dopo un altro sullo stesso telefono non deve ritrovare quello che l'altro stava scrivendo. La
 * bozza si salva come `{ autore, bozza }` e si restituisce solo a chi l'ha scritta.
 */
export type BozzaConAutore<T> = { autore: string; bozza: T };

function bozzaConAutore<T>(grezza: string | null): BozzaConAutore<T> | null {
  if (!grezza) return null;
  try {
    const letta = JSON.parse(grezza) as unknown;
    if (!letta || typeof letta !== 'object' || !('bozza' in letta)) return null;
    const autore = (letta as { autore?: unknown }).autore;
    if (typeof autore !== 'string' || autore === '') return null;
    return letta as BozzaConAutore<T>;
  } catch {
    return null;
  }
}

/** Salva la bozza col nome di chi la scrive. */
export function salvaBozzaDi<T>(key: string, autore: string, valore: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ autore, bozza: valore } satisfies BozzaConAutore<T>));
  } catch {
    /* quota/Safari privata: ignora */
  }
}

/**
 * Legge la bozza. Una bozza senza autore (scritta prima di questa regola, o non si sa da chi) si
 * toglie; con `autore` noto si toglie anche quella di un altro. Con `autore` non ancora noto la
 * bozza torna insieme al suo autore, e chi la usa lo confronta appena sa chi è collegato.
 */
export function leggiBozzaDi<T>(key: string, autore?: string | null): BozzaConAutore<T> | null {
  try {
    const grezza = localStorage.getItem(key);
    if (grezza === null) return null;
    const letta = bozzaConAutore<T>(grezza);
    if (!letta || (autore && letta.autore !== autore)) {
      localStorage.removeItem(key);
      return null;
    }
    return letta;
  } catch {
    return null;
  }
}

/** Toglie la bozza se non è di `autore` (con `autore` nullo, cioè nessuno collegato, la toglie sempre). */
export function togliBozzaSeNonDi(key: string, autore: string | null): void {
  try {
    const grezza = localStorage.getItem(key);
    if (grezza === null) return;
    const letta = bozzaConAutore(grezza);
    if (!autore || !letta || letta.autore !== autore) localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
