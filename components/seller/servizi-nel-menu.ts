import { ClipboardList, Globe, MapPin, Share2, Video, type LucideIcon } from 'lucide-react';
import { LISTINO, SERVIZI_AGENZIA, SLUG_SERVIZIO, type ServizioAgenzia } from '@/lib/agenzia/preventivo';

/**
 * LE VOCI DEL MENU «SERVIZI» — 23/11/2026.
 *
 * Nicola: «è dentro preventivo, ma ogni servizio ha la sua voce dentro il menu», poi «la voce
 * preventivo, chiamala servizi». Il menu del venditore ha un gruppo «Servizi»: la prima voce è
 * il preventivo intero, poi una voce per
 * ogni servizio, nell'ordine del listino. Le voci nascono da SERVIZI_AGENZIA: un servizio nuovo
 * nel listino ha la sua voce senza toccare il menu.
 */

const ICONE: Record<ServizioAgenzia, LucideIcon> = {
  foto_video: Video,
  social: Share2,
  sito_web: Globe,
  google_maps: MapPin,
};

/** Le etichette corte del menu: il titolo intero del listino non ci sta nella barra. */
const ETICHETTE: Record<ServizioAgenzia, string> = {
  foto_video: 'Foto e video',
  social: 'Gestione social',
  sito_web: 'Sito web',
  google_maps: 'Scheda Google',
};

export const HREF_PREVENTIVO = '/seller/preventivo';

export const hrefServizio = (id: ServizioAgenzia) => `${HREF_PREVENTIVO}/${SLUG_SERVIZIO[id]}`;

export type VoceDelMenu = { href: string; icon: LucideIcon; label: string };

export const VOCI_PREVENTIVO: VoceDelMenu[] = [
  { href: HREF_PREVENTIVO, icon: ClipboardList, label: 'Il tuo preventivo' },
  ...SERVIZI_AGENZIA.map((id) => ({ href: hrefServizio(id), icon: ICONE[id], label: ETICHETTE[id] })),
];

/** Il titolo intero del servizio, per la pagina: lo stesso del preventivo. */
export const titoloServizio = (id: ServizioAgenzia) => LISTINO[id].titolo;
