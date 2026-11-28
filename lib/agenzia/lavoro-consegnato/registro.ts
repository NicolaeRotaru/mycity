import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import { AnalisiSchema, SitoSchema, SocialSchema, type LavoroConsegnato, type Sito } from './tipi';
import { CAFFE_DI_PIACENZA_ID, SITI_PER_NEGOZIO } from './siti';
import analisiSdg from './sdg/analisi.json';
import socialSdg from './sdg/social.json';

/**
 * SOLO LATO SERVER (le rotte /api/seller/lavoro-consegnato e /api/admin/lavoro-consegnato): l'analisi di SDG è interna e non deve finire
 * nel bundle del browser degli altri venditori. Non importare questo file da componenti client, né dal portiere.
 */
function leggi<T extends z.ZodTypeAny>(nome: string, negozioId: string, schema: T, grezzo: unknown): z.infer<T> | undefined {
  if (grezzo === undefined) return undefined;
  const r = schema.safeParse(grezzo);
  if (r.success) return r.data;
  logger.error(`[lavoro-consegnato] ${nome} del negozio ${negozioId} non valido: la parte non si mostra`, { problemi: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
  return undefined;
}

/**
 * 27/11/2026 — Il lavoro consegnato, negozio per negozio (chiave = id del venditore). SDG è cliente Premium di
 * se stessa coi tre lavori; il Caffè di Piacenza (Business, pagato in contanti il 27/11) ha il suo sito.
 * Il sito di ogni negozio sta in ./siti.ts, che legge anche il portiere.
 */
type VoceDelRegistro = { fascia: LavoroConsegnato['fascia']; social?: unknown; analisi?: unknown };
const REGISTRO: ReadonlyMap<string, VoceDelRegistro> = new Map<string, VoceDelRegistro>([
  [SDG_SELLER_ID, { fascia: 'premium', social: socialSdg, analisi: analisiSdg }],
  [CAFFE_DI_PIACENZA_ID, { fascia: 'business' }],
]);

export function lavoroConsegnatoDi(negozioId: string): LavoroConsegnato | null {
  const id = typeof negozioId === 'string' ? negozioId.trim().toLowerCase() : '';
  const voce = REGISTRO.get(id);
  if (!voce) return null;
  return {
    negozioId: id,
    fascia: voce.fascia,
    sito: leggi('sito', id, SitoSchema, SITI_PER_NEGOZIO.get(id)),
    social: leggi('social', id, SocialSchema, voce.social),
    analisi: leggi('analisi', id, AnalisiSchema, voce.analisi),
  };
}

/**
 * 27/11/2026 — I negozi che hanno un lavoro consegnato, per la pagina Admin «Lavoro dei clienti»
 * (Nicola: «dammi modo di accedere all'account Caffè di Piacenza» → «vederlo da Admin», in sola lettura).
 */
export function negoziConLavoroConsegnato(): string[] {
  return [...REGISTRO.keys()];
}

/**
 * 27/11/2026 — Solo il sito del negozio, per la pagina del link del preventivo (Nicola: «mettilo nel momento in
 * cui l'imprenditore ha cliccato sul link che gli ha inviato il venditore»). Quella pagina è aperta a chi ha il
 * link: qui non passano mai il piano social né l'analisi. Passa la fascia del sito (versione Business, Premium…),
 * perché la pagina dica con quale abbonamento quel sito va online (collaudo del 27/11).
 */
export function sitoConsegnatoDi(negozioId: string): { sito: Sito; fascia: LavoroConsegnato['fascia'] } | null {
  const lavoro = lavoroConsegnatoDi(negozioId);
  return lavoro?.sito ? { sito: lavoro.sito, fascia: lavoro.fascia } : null;
}

