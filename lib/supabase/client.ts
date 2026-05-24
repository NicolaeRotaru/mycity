'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabasePublic } from '@/lib/env';

let _supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_supabase) return _supabase;
  const { url, key } = requireSupabasePublic();
  // createBrowserClient gestisce la sessione in cookie (SameSite=Lax)
  // così il middleware server-side può leggerla in modo affidabile.
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
