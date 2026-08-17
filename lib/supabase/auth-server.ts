import { createClient } from '@supabase/supabase-js';

/**
 * Client Supabase per l'autenticazione dentro una rotta server, uno per
 * richiesta.
 *
 * Perché non si usa quello di `lib/supabase/client.ts`: quel modulo è marcato
 * `'use client'` e tiene un client SOLO in una variabile di modulo. Dentro un
 * processo Node quella variabile è condivisa da tutte le richieste che arrivano
 * a quel processo: due persone che accedono nello stesso momento lavorano sullo
 * stesso oggetto, e la sessione di una può finire nelle mani dell'altra. Qui
 * ogni richiesta ha il suo, e non si salva niente in memoria fra una e l'altra.
 */
function clientPerRichiesta() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Variabili Supabase mancanti: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const authServer = {
  async signIn(email: string, password: string, options?: { captchaToken?: string }) {
    const client = clientPerRichiesta();
    const res = await client.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: options?.captchaToken },
    });
    return { ...res, client };
  },

  async signUp(
    email: string,
    password: string,
    options?: { captchaToken?: string; emailRedirectTo?: string; data?: Record<string, unknown> },
  ) {
    const client = clientPerRichiesta();
    return await client.auth.signUp({
      email,
      password,
      options: {
        captchaToken: options?.captchaToken,
        emailRedirectTo: options?.emailRedirectTo,
        data: options?.data,
      },
    });
  },
};
