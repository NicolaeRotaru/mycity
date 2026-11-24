import { BadgeCheck, Globe, Share2, Video, type LucideIcon } from 'lucide-react';
import { LISTINO, SERVIZI_AGENZIA, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO, hrefServizio } from '@/lib/agenzia/indirizzi-servizi';

/**
 * LE VOCI DEL MENU «SERVIZI» — 23/11/2026, rifatte il 24/11/2026.
 *
 * Nicola (24/11): «togli sempre la voce preventivo… Di per sé il preventivo sono quelle tre voci:
 * foto e video, sito e social, gestione di social». Il gruppo «Servizi» ha una voce per ogni
 * servizio, nell'ordine del listino, e in fondo «Abbonamento», la pagina dove si sceglie e si
 * paga. Le voci dei servizi nascono da SERVIZI_AGENZIA: un servizio nuovo nel listino ha la sua
 * voce senza toccare il menu.
 */

const ICONE: Record<ServizioAgenzia, LucideIcon> = {
  foto_video: Video,
  sito_web: Globe,
  social: Share2,
};

/** Le etichette corte del menu: il titolo intero del listino non ci sta nella barra. */
export const ETICHETTE_SERVIZI: Record<ServizioAgenzia, string> = {
  foto_video: 'Foto e video',
  sito_web: 'Sito web',
  social: 'Gestione social',
};

export { PERCORSO_ABBONAMENTO, hrefServizio };

export type VoceDelMenu = { href: string; icon: LucideIcon; label: string };

export const VOCI_SERVIZI: VoceDelMenu[] = [
  ...SERVIZI_AGENZIA.map((id) => ({ href: hrefServizio(id), icon: ICONE[id], label: ETICHETTE_SERVIZI[id] })),
  { href: PERCORSO_ABBONAMENTO, icon: BadgeCheck, label: 'Abbonamento' },
];

/** Il titolo intero del servizio, per la pagina. */
export const titoloServizio = (id: ServizioAgenzia) => LISTINO[id].titolo;
