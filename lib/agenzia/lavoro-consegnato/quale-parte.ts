import type { LavoroConsegnato } from './tipi';
import type { ServizioAgenzia } from '@/lib/agenzia/preventivo';

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
