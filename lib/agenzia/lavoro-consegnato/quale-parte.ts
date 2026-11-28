import type { LavoroConsegnato } from './tipi';
import type { ServizioAgenzia } from '@/lib/agenzia/preventivo';
import type { LavoroDellOrdine } from '@/lib/agenzia/lavoro-dell-ordine';

/**
 * Quale parte del lavoro consegnato va mostrata in questa pagina servizio (null = la pagina di oggi, col preventivo).
 * sito_web→sito, social→social, analisi→analisi; foto_video non ha mai una parte.
 */
export type ParteConsegnata = 'sito' | 'social' | 'analisi';
const PARTE_DEL_SERVIZIO: Partial<Record<string, ParteConsegnata>> = { sito_web: 'sito', social: 'social', analisi: 'analisi' };

export function parteDaMostrare(servizio: ServizioAgenzia | string, lavoro: LavoroConsegnato | null | undefined): ParteConsegnata | null {
  const parte = PARTE_DEL_SERVIZIO[servizio];
  if (!parte || !lavoro || !lavoro[parte]) return null;
  return parte;
}

/**
 * 28/11/2026 — La parte del lavoro nato con l'ordine di SDG da mostrare in questa pagina servizio. Le tre voci ci
 * sono sempre (pronte o «in preparazione»), perché l'ordine le promette tutte e tre; foto_video no.
 */
export function parteDellOrdine(servizio: ServizioAgenzia | string, ordine: LavoroDellOrdine | null | undefined): ParteConsegnata | null {
  const parte = PARTE_DEL_SERVIZIO[servizio];
  return parte && ordine ? parte : null;
}
