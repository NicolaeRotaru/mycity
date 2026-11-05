'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import '@/lib/zod-i18n'; // attiva Zod errorMap IT globalmente
import { supabase } from '@/lib/supabase/client';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s di stale per ridurre refetch su tab visibili più volte di seguito.
            staleTime: 30 * 1000,
            // GC dopo 5 min: libera memoria per query non più referenziate.
            gcTime: 5 * 60 * 1000,
            // Niente refetch automatico al focus della finestra (era default true)
            // → evita richieste a sorpresa quando l'utente torna sulla tab.
            refetchOnWindowFocus: false,
            // Niente polling in background (tab non visibile) → battery saver mobile
            refetchIntervalInBackground: false,
            // 1 retry su errore di rete, poi smetti.
            retry: 1,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  /**
   * 5/11/2026 — CAMBIANDO ACCOUNT SULLO STESSO TELEFONO SI VEDEVANO I DATI DEL PRECEDENTE.
   * Le letture del pannello negozio hanno chiavi senza l'utente (['seller','orders'], …) e l'uscita
   * non svuotava la memoria: entro 30 secondi il nuovo negozio leggeva ordini e clienti dell'altro.
   * Qui la memoria si svuota all'uscita e quando entra un account diverso da quello di prima.
   */
  useEffect(() => {
    let ultimo: string | null = null;
    // Difensivo: dove il client non ha l'ascolto dell'accesso (prove, ambienti ridotti) non si
    // fa niente invece di far cadere tutta l'applicazione.
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      const chi = sessione?.user?.id ?? null;
      if (evento === 'SIGNED_OUT' || (chi && ultimo && chi !== ultimo)) queryClient.clear();
      if (chi) ultimo = chi;
      if (evento === 'SIGNED_OUT') ultimo = null;
    });
    return () => data?.subscription?.unsubscribe();
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
