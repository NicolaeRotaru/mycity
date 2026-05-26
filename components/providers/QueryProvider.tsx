'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
