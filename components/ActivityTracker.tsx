'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { hasConsent } from '@/lib/consent';
import { chiaveDellaPaginaVista, serveIlConsensoStatistico } from '@/lib/analytics/tracciamento';

/**
 * Beacon di sorveglianza (lato "Grande Fratello" admin).
 *
 * Invia a /api/track gli eventi del visitatore — anche ANONIMO:
 *  - page_view ad ogni cambio rotta,
 *  - session_start una volta per tab,
 *  - login / logout via supabase.auth.onAuthStateChange (il login è client-side).
 *
 * L'IP, il device e il cookie identificativo `mc_vid` sono gestiti SERVER-side
 * dalla route (qui non serve né si vuole leggere l'IP). Usa sendBeacon (sopravvive
 * all'unload) con fallback a fetch keepalive. credentials:'include' → la route
 * vede la sessione e associa l'utente loggato.
 *
 * GATE CONSENSO: il beacon parte SOLO se l'utente ha prestato consenso
 * "analytics" (hasConsent('analytics')). La profilazione cross-session tramite
 * il cookie persistente `mc_vid` non è un cookie tecnico/necessario, quindi
 * richiede consenso preventivo (art. 122 Codice Privacy / linee guida Garante).
 */

type TrackPayload = {
  // Solo i tre che il sito manda davvero: l'elenco del server dice gli stessi.
  event_type: 'page_view' | 'login' | 'logout';
  path?: string;
  referrer?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
};

const SESSION_KEY = 'mc_sid';

function getSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return undefined;
  }
}

function send(payload: TrackPayload) {
  if (typeof window === 'undefined') return;
  /**
   * 27/8/2026 (R064) — IL CANCELLO STAVA QUI, PRIMA DI QUALUNQUE DISTINZIONE.
   *
   * Nessun tracciamento del comportamento (e nemmeno il cookie `mc_vid` che la rotta deposita)
   * senza il consenso statistico: quello resta. Ma accesso e disconnessione non sono
   * sorveglianza del visitatore, sono sicurezza — e l'informativa li dichiara come tali a TUTTI.
   * Passando di qui non partivano mai per chi rifiuta i cookie, quindi il registro degli accessi
   * era vuoto proprio per le persone più attente alla privacy: se a una di loro rubano l'account,
   * non abbiamo niente da guardare. La rotta la sua parte la faceva già giusta.
   */
  if (serveIlConsensoStatistico(payload.event_type) && !hasConsent('analytics')) return;
  const body = JSON.stringify({ ...payload, session_id: payload.session_id ?? getSessionId() });
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
  } catch {
    /* fallback sotto */
  }
  try {
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'include',
    });
  } catch {
    /* best-effort: un beacon non deve mai rompere nulla */
  }
}

export default function ActivityTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastUrl = useRef<string | null>(null);
  const firstView = useRef(true);

  // page_view ad ogni cambio rotta (de-dup su url, evita doppio StrictMode).
  // Il primo invio porta `new_session: true` (così non serve un beacon
  // session_start separato che, partendo in parallelo senza cookie mc_vid,
  // genererebbe un secondo anon_id per lo stesso visitatore).
  //
  // 27/8/2026 (R171) — la deduplica guardava l'indirizzo INTERO, e sulla pagina dei risultati
  // l'indirizzo cambia a ogni tocco di filtro: sette filtri = otto pagine viste per una ricerca
  // sola. La chiave adesso tiene percorso e ricerca, e i filtri non contano.
  useEffect(() => {
    const url = chiaveDellaPaginaVista(pathname ?? '/', searchParams);
    if (lastUrl.current === url) return;
    lastUrl.current = url;
    const isFirst = firstView.current;
    firstView.current = false;
    send({
      event_type: 'page_view',
      path: url,
      referrer: document.referrer || undefined,
      metadata: isFirst ? { new_session: true } : undefined,
    });
  }, [pathname, searchParams]);

  // login / logout — logghiamo solo le vere transizioni di sessione.
  // Supabase emette SIGNED_IN anche su refresh token / refocus tab: per non
  // generare falsi "login" tracciamo solo il passaggio assente → presente.
  const lastUserId = useRef<string | null>(null);
  const authInit = useRef(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user?.id ?? null;
      if (!authInit.current) {
        // primo evento (INITIAL_SESSION): stato di partenza, non è un login
        authInit.current = true;
        lastUserId.current = uid;
        return;
      }
      if (uid && uid !== lastUserId.current) send({ event_type: 'login' });
      else if (!uid && lastUserId.current) send({ event_type: 'logout' });
      lastUserId.current = uid;
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
