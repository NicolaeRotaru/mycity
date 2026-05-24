'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  _supabase = createBrowserClient(url, key);
  return _supabase;
}

// Proxy lazy: API identica a prima — supabase.from(...), supabase.auth, ...
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getClient();
    return (client as any)[prop];
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
