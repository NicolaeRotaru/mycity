'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

/**
 * R01-varie — Le bozze del modulo di reclamo (app/orders/[id]/dispute/page.tsx) stanno in questa
 * scheda sotto `mycity:bozza-reclamo:<ordine>`, con l'id di chi le ha scritte. Una bozza col segno
 * `perIlRientro` è quella tenuta da parte quando la sessione è scaduta mentre si scriveva.
 * - All'uscita voluta (una chiamata a `supabase.auth.signOut()`, cioè ogni tasto «Esci») si
 *   tolgono tutte.
 * - All'uscita non chiesta (la sessione scaduta) si tolgono tutte tranne quelle col segno, che
 *   aspettano il rientro.
 * - Quando entra qualcuno si tolgono quelle scritte da un altro.
 * Le altre chiavi della scheda non si toccano.
 */
const PREFISSO_BOZZA = 'mycity:bozza-reclamo:';
type Bozza = { utente?: unknown; perIlRientro?: unknown } | null;

function togliBozze(daTogliere: (bozza: Bozza) => boolean) {
  try {
    const scheda = window.sessionStorage;
    const chiavi: string[] = [];
    for (let i = 0; i < scheda.length; i++) {
      const k = scheda.key(i);
      if (k?.startsWith(PREFISSO_BOZZA)) chiavi.push(k);
    }
    for (const k of chiavi) {
      let bozza: Bozza = null;
      try {
        bozza = JSON.parse(scheda.getItem(k) ?? 'null') as Bozza;
      } catch {
        bozza = null;
      }
      if (daTogliere(bozza)) scheda.removeItem(k);
    }
  } catch {
    // Memoria della scheda non disponibile (navigazione privata, blocchi): niente da togliere.
  }
}

/**
 * 27/11/2026 (R01-012) — LA BOZZA DELLA CASSA NON RESTA A CHI VIENE DOPO.
 *
 * Chi ordina da ospite lascia nome, telefono e indirizzo in `mc_checkout_draft` (app/checkout/page.tsx)
 * prima di andare all'accesso, perché dopo l'accesso il modulo si riempia da solo. Se l'accesso non
 * si completa, o la bozza non viene ripresa, restava nel browser anche dopo «Esci» e passava a
 * chiunque aprisse la cassa dopo, sul tablet di casa o sul computer del negozio. All'uscita
 * dall'account (ogni SIGNED_OUT: «Esci» o sessione finita) si toglie dalle due memorie; l'ingresso
 * di chi la stava aspettando non la tocca.
 */
const BOZZA_DELLA_CASSA = 'mc_checkout_draft';
function togliBozzaDellaCassa() {
  for (const memoria of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      memoria().removeItem(BOZZA_DELLA_CASSA);
    } catch {
      // Memoria non disponibile (navigazione privata, blocchi): niente da togliere.
    }
  }
}

const AVVOLTO = Symbol.for('mycity.uscita-voluta');

/**
 * R01-varie — Quante uscite volute sono passate da questa scheda: chi sta aspettando una risposta
 * (il modulo di reclamo) guarda se il numero è cambiato prima di riscrivere una bozza. Sta su
 * `globalThis` con una chiave condivisa (la legge anche app/orders/[id]/dispute/page.tsx), così
 * vale anche se il modulo è caricato due volte.
 */
const USCITE_VOLUTE = Symbol.for('mycity.uscite-volute');
function contaUscitaVoluta() {
  const g = globalThis as unknown as Record<PropertyKey, unknown>;
  const prima = g[USCITE_VOLUTE];
  g[USCITE_VOLUTE] = (typeof prima === 'number' ? prima : 0) + 1;
}

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
   * 22/11/2026 — IL TRADUTTORE DI ZOD ARRIVA DOPO, NON NEL PACCHETTO DI OGNI PAGINA.
   * Qui c'era `import '@/lib/zod-i18n'`: il traduttore italiano degli errori dei moduli (e Zod con
   * lui) viaggiava nel codice comune di ogni pagina, anche dove non c'è nessun modulo. Adesso si
   * carica a parte, appena il provider è montato, e da lì vale per tutta la scheda (`z.setErrorMap`
   * è globale). Caso limite: un modulo che valida prima che il pezzo sia arrivato (nei primi istanti
   * dopo l'apertura della pagina, o se il pezzo non si scarica) mostra il testo inglese di Zod.
   */
  useEffect(() => {
    import('@/lib/zod-i18n').catch(() => {
      // Il pezzo non si è scaricato (rete caduta): restano i testi predefiniti di Zod.
    });
  }, []);

  /**
   * 5/11/2026 — CAMBIANDO ACCOUNT SULLO STESSO TELEFONO SI VEDEVANO I DATI DEL PRECEDENTE.
   * Le letture del pannello negozio hanno chiavi senza l'utente (['seller','orders'], …) e l'uscita
   * non svuotava la memoria: entro 30 secondi il nuovo negozio leggeva ordini e clienti dell'altro.
   * Qui la memoria si svuota all'uscita e quando entra un account diverso da quello di prima.
   */
  useEffect(() => {
    let ultimo: string | null = null;
    /**
     * R01-varie — Senza sessione le domande a video si rileggono, ma quello che leggono vale solo
     * finché nessuno entra: più d'una ha la chiave senza l'utente e senza sessione risponde «niente»
     * (per esempio lo stato dei pagamenti del negozio). Al primo ingresso dopo un'uscita, o dopo un
     * avvio senza sessione, si riparte da zero anche se `ultimo` è già vuoto.
     */
    let senzaSessione = false;
    // Difensivo: dove il client non ha l'ascolto dell'accesso (prove, ambienti ridotti) non si
    // fa niente invece di far cadere tutta l'applicazione.
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    /**
     * R01-varie — Si riparte da zero senza lasciare indietro chi sta guardando. Le domande che
     * nessuno guarda escono dalla memoria; quelle a video tornano allo stato iniziale, chi le guarda
     * se ne accorge subito (senza aspettare un ridisegno) e quelle accese si rileggono con la
     * sessione nuova. Le scritture tenute in memoria si buttano come prima.
     */
    const ricomincia = () => {
      queryClient.getMutationCache().clear();
      queryClient.removeQueries({ predicate: (q) => q.getObserversCount() === 0 });
      void queryClient.resetQueries({ predicate: (q) => q.getObserversCount() > 0 });
    };
    /**
     * R01-varie — L'uscita voluta e la sessione scaduta arrivano entrambe come SIGNED_OUT: per
     * distinguerle si segna ogni chiamata a `signOut` del client (lo stesso per tutta la scheda).
     * Il segno vale per il primo SIGNED_OUT e si azzera comunque quando `signOut` finisce, anche
     * se fallisce (il client avvisa prima di finire).
     */
    let uscitaVoluta = false;
    const auth = supabase.auth as unknown as Record<PropertyKey, unknown>;
    const originale = auth.signOut as ((...a: unknown[]) => Promise<unknown>) | undefined;
    let avvolto: ((...a: unknown[]) => Promise<unknown>) | null = null;
    if (typeof originale === 'function' && !(originale as unknown as Record<PropertyKey, unknown>)[AVVOLTO]) {
      avvolto = async (...argomenti: unknown[]) => {
        uscitaVoluta = true;
        try {
          return await originale.apply(auth, argomenti);
        } finally {
          uscitaVoluta = false;
        }
      };
      (avvolto as unknown as Record<PropertyKey, unknown>)[AVVOLTO] = true;
      auth.signOut = avvolto;
    }
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      const chi = sessione?.user?.id ?? null;
      const entrato = chi !== null && (ultimo !== null ? chi !== ultimo : senzaSessione);
      if (evento === 'SIGNED_OUT' || entrato) ricomincia();
      if (evento === 'SIGNED_OUT') {
        const voluta = uscitaVoluta;
        uscitaVoluta = false;
        if (voluta) contaUscitaVoluta();
        togliBozze((b) => voluta || b?.perIlRientro !== true);
        togliBozzaDellaCassa();
      } else if (chi) {
        togliBozze((b) => b?.utente !== chi);
      }
      if (chi) {
        ultimo = chi;
        senzaSessione = false;
      } else if (evento === 'SIGNED_OUT' || evento === 'INITIAL_SESSION') {
        senzaSessione = true;
      }
      if (evento === 'SIGNED_OUT') ultimo = null;
    });
    return () => {
      data?.subscription?.unsubscribe();
      if (avvolto && auth.signOut === avvolto) auth.signOut = originale;
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
