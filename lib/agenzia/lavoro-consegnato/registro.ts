import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { SDG_SELLER_ID } from '@/lib/products/sdgSeller';
import { AnalisiSchema, SitoSchema, SocialSchema, type LavoroConsegnato } from './tipi';
import { CAFFE_DI_PIACENZA_ID, SITI_PER_NEGOZIO } from './siti';
import analisiSdg from './sdg/analisi.json';
import socialSdg from './sdg/social.json';

/**
 * SOLO LATO SERVER (la rotta /api/seller/lavoro-consegnato): l'analisi di SDG è interna e non deve finire
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
