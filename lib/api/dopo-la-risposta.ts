import { after } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * IL LAVORO CHE NON DEVE FAR ASPETTARE, MA NEMMENO SPARIRE.
 *
 * Radiografia del 27/8/2026, terzo bloccante. Le comunicazioni dopo un ordine —
 * email al cliente, email al negozio, campanella — partivano come promesse non
 * attese: `const avvisi = (async () => { ... })()` seguito da `void
 * avvisi.catch(...)`. Nessuno le aspettava, ed è giusto: Stripe considera
 * fallita una consegna che non riceve risposta entro pochi secondi.
 *
 * Ma su una piattaforma serverless — la nostra è Vercel — la funzione può
 * essere spenta appena ha risposto. Il lavoro lanciato «per conto suo» non è
 * garantito: può morire a metà, o non partire affatto. Sul percorso dei soldi
 * vuol dire ordine pagato e nessuno avvisato.
 *
 * `after()` di Next 15 è esattamente il pezzo che mancava: la risposta parte
 * subito, e la piattaforma tiene viva l'esecuzione finché il lavoro registrato
 * non è finito. Il grep del 27/8 su tutto `app/` e `lib/` contava zero usi di
 * `after` e zero di `waitUntil`.
 *
 * IL RIPIEGO. `after()` vive dentro una richiesta: chiamato fuori (uno script,
 * un lavoro periodico avviato a mano, una prova) lancia. Qui si ripiega sul
 * comportamento di prima — che fuori da un server serverless funziona — invece
 * di far fallire un ordine già pagato.
 */
export function dopoLaRisposta(lavoro: () => Promise<void>, cosa: string): void {
  const conRete = () =>
    lavoro().catch((e) =>
      logger.warn(`[dopo-la-risposta] ${cosa} non completato`, {
        message: e instanceof Error ? e.message : 'errore',
      }),
    );

  try {
    after(conRete);
  } catch {
    // Nessun contesto di richiesta: si fa partire lo stesso, senza attendere.
    void conRete();
  }
}
