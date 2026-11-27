import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import sitoSdg from './sdg/sito.json';
import sitoCaffeDiPiacenza from './caffe-di-piacenza/sito.json';

/**
 * I SITI GIÀ FATTI PER I NEGOZI — 27/11/2026.
 *
 * Nicola (27/11 ~17:05): il Caffè di Piacenza è iscritto col Business, quindi «nella voce del menu sito web
 * ci deve essere già il suo sito web versione business». Qui sta l'elenco dei siti consegnati, uno per
 * negozio (chiave = id del venditore). Un negozio nuovo: la sua cartella con sito.json (forma di
 * ad-mycity/consegne/sdg-premium/CONTRATTO.md) e una riga qui.
 *
 * Lo legge anche il portiere (middleware.ts) per lasciar vedere il sito dentro la pagina «Sito web»
 * (frame-src): per questo qui non c'è niente oltre ai sito.json, che non hanno dati riservati.
 */
export const CAFFE_DI_PIACENZA_ID = '429d0e22-4b3f-40db-8f81-ab331701fb81';

export const SITI_PER_NEGOZIO: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  [SDG_SELLER_ID, sitoSdg],
  [CAFFE_DI_PIACENZA_ID, sitoCaffeDiPiacenza],
]);

/**
 * Le origini (https://host) dei siti già online, da mettere in frame-src: solo quelle, mai un dominio intero
 * come *.vercel.app. Un indirizzo che non è https o non è leggibile non entra.
 */
export function originiDeiSitiOnline(siti: Iterable<unknown> = SITI_PER_NEGOZIO.values()): string[] {
  const origini = new Set<string>();
  for (const s of siti) {
    if (!s || typeof s !== 'object') continue;
    const { stato, indirizzo } = s as { stato?: unknown; indirizzo?: unknown };
    if (stato !== 'online' || typeof indirizzo !== 'string') continue;
    try {
      const u = new URL(indirizzo);
      if (u.protocol === 'https:') origini.add(u.origin);
    } catch {
      /* indirizzo storto: non entra */
    }
  }
  return [...origini];
}
