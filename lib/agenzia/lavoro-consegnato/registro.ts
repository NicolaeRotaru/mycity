import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { SDG_SELLER_ID, eDiSdg } from '@/lib/products/sdgSeller';
import { AnalisiSchema, SitoSchema, SocialSchema, type LavoroConsegnato } from './tipi';
import analisiSdg from './sdg/analisi.json';
import socialSdg from './sdg/social.json';
import sitoSdg from './sdg/sito.json';

/**
 * SOLO LATO SERVER (la rotta /api/seller/lavoro-consegnato): l'analisi di SDG è interna e non deve finire
 * nel bundle del browser degli altri venditori. Non importare questo file da componenti client.
 */
function leggi<T extends z.ZodTypeAny>(nome: string, schema: T, grezzo: unknown): z.infer<T> | undefined {
  const r = schema.safeParse(grezzo);
  if (r.success) return r.data;
  logger.error(`[lavoro-consegnato] ${nome} di SDG non valido: la parte non si mostra`, { problemi: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
  return undefined;
}

export function lavoroConsegnatoDi(negozioId: string): LavoroConsegnato | null {
  if (!eDiSdg(negozioId)) return null;
  return {
    negozioId: SDG_SELLER_ID,
    fascia: 'premium',
    sito: leggi('sito', SitoSchema, sitoSdg),
    social: leggi('social', SocialSchema, socialSdg),
    analisi: leggi('analisi', AnalisiSchema, analisiSdg),
  };
}
