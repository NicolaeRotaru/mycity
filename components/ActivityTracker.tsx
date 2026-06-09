'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

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
 * Questo log interno di sicurezza è di prima parte e indipendente dal consenso
 * analytics di terze parti (GA4/PostHog), coerentemente con lib/consent.ts che
 * classifica sessione/sicurezza come "necessary".
 */

type TrackPayload = {
  event_type: 'page_view' | 'login' | 'logout' | 'signup';
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
  useEffect(() => {
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : '');
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
