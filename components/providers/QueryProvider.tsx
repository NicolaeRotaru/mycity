'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import '@/lib/zod-i18n'; // attiva Zod errorMap IT globalmente

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

  // S10 (5/11/2026) — I dati gia' scaricati (nome, ultimi acquisti, ordini)
  // restavano in memoria dopo «Esci»: le uscite sono navigazioni interne e il
  // QueryClient sopravvive, quindi la home mostrava a chi veniva dopo i dati di
  // chi era appena uscito. Si svuota all'uscita e quando entra un'altra persona.
  useEffect(() => {
    let ultimo: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      const id = sessione?.user?.id ?? null;
      if (evento === 'SIGNED_OUT' || (evento === 'SIGNED_IN' && ultimo !== undefined && ultimo !== id)) {
        queryClient.clear();
      }
      if (evento === 'SIGNED_OUT') ultimo = null;
      else if (id) ultimo = id;
      else if (ultimo === undefined) ultimo = null;
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
