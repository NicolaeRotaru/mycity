'use client';

import { createBrowserClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * 31/10/2026 (ondata 6) — IL COOKIE DI ACCESSO NON RESTA PIU' DI 6 MESI.
 *
 * @supabase/ssr 0.5.2 scrive la sessione (sb-*-auth-token) con maxAge di 400 giorni e lo
 * impone anche sopra `cookieOptions` (dist/main/cookies.js): passare un maxAge non basta.
 * La cookie policy diceva «1 settimana». Scelta di Nicola del 31/10 (fatto
 * privacy.consenso-cookie-durata): 6 mesi, come la scelta sui cookie. Per questo qui il
 * browser scrive i cookie da se', con lo stesso formato della libreria, e taglia la durata.
 * Prova: tests/unit/il-cookie-di-accesso-dura-quanto-dice-la-policy.test.tsx
 */
const DURATA_MASSIMA_SESSIONE_S = 180 * 24 * 60 * 60;

function leggiCookie(): { name: string; value: string }[] {
  if (typeof document === 'undefined' || !document.cookie) return [];
  return document.cookie.split(/;\s*/).flatMap((coppia) => {
    const uguale = coppia.indexOf('=');
    if (uguale <= 0) return [];
    const name = coppia.slice(0, uguale).trim();
    const grezzo = coppia.slice(uguale + 1).trim();
    let value = grezzo;
    try {
      value = decodeURIComponent(grezzo);
    } catch {
      // valore non codificato da noi: lo si passa com'e'
    }
    return [{ name, value }];
  });
}

function scriviCookie(name: string, value: string, o: CookieOptions = {}): void {
  if (typeof document === 'undefined') return;
  const parti = [`${name}=${encodeURIComponent(value)}`];
  if (typeof o.maxAge === 'number') parti.push(`Max-Age=${Math.min(Math.floor(o.maxAge), DURATA_MASSIMA_SESSIONE_S)}`);
  else if (o.expires) parti.push(`Expires=${new Date(Math.min(o.expires.getTime(), Date.now() + DURATA_MASSIMA_SESSIONE_S * 1000)).toUTCString()}`);
  if (o.domain) parti.push(`Domain=${o.domain}`);
  parti.push(`Path=${o.path ?? '/'}`);
  if (o.sameSite) parti.push(`SameSite=${o.sameSite === true ? 'Strict' : o.sameSite.charAt(0).toUpperCase() + o.sameSite.slice(1)}`);
  if (o.secure) parti.push('Secure');
  document.cookie = parti.join('; ');
}

let _supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_supabase) return _supabase;
  // Must use literal access — Next.js only inlines process.env.NEXT_PUBLIC_*
  // at build time when the key appears as a string literal, not via dynamic bracket access.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Variabili Supabase mancanti: controlla NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  _supabase = createBrowserClient(url, key, {
    cookies: {
      getAll: leggiCookie,
      setAll: (cookie: { name: string; value: string; options: CookieOptions }[]) =>
        cookie.forEach(({ name, value, options }) => scriviCookie(name, value, options)),
    },
  });
  return _supabase;
}

// Proxy lazy: API identica a prima — supabase.from(...), supabase.auth, ...
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop: keyof SupabaseClient) {
    const client = getClient() as unknown as Record<PropertyKey, unknown>;
    return client[prop];
  },
});

export const auth = {
  signUp: async (email: string, password: string, options?: { captchaToken?: string; emailRedirectTo?: string }) => {
    return await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken: options?.captchaToken,
        emailRedirectTo: options?.emailRedirectTo,
      },
    });
  },
  signIn: async (email: string, password: string, options?: { captchaToken?: string }) => {
    return await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: options?.captchaToken },
    });
  },
  signOut: async () => {
    return await supabase.auth.signOut();
  },
};
