import { Globe, Share2, TrendingUp, Video, type LucideIcon } from 'lucide-react';
import { LISTINO, SERVIZI_AGENZIA, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO, hrefServizio } from '@/lib/agenzia/indirizzi-servizi';
import { ETICHETTE_SERVIZI } from '@/lib/agenzia/servizi-scelti';

/**
 * LE VOCI DEL MENU «SERVIZI» — 23/11/2026, rifatte il 24/11/2026.
 *
 * Nicola (24/11): «togli sempre la voce preventivo… Di per sé il preventivo sono quelle tre voci:
 * foto e video, sito e social, gestione di social». Il gruppo «Servizi» ha una voce per ogni
 * servizio, nell'ordine del listino, e in fondo «Abbonamento», la pagina dove si sceglie e si
 * paga. Le voci dei servizi nascono da SERVIZI_AGENZIA: un servizio nuovo nel listino ha la sua
 * voce senza toccare il menu.
 *
 * 24/11/2026, sera — Nicola: «usa la tecnica di Claude: lo metti nelle impostazioni, però è sempre
 * visibile». «Abbonamento» esce dal gruppo: sta in fondo al menu, sotto il nome del negozio col
 * piano scritto («Piano Business»), e nel Profilo (components/seller/MenuAccount.tsx).
 */

const ICONE: Record<ServizioAgenzia, LucideIcon> = {
  foto_video: Video,
  sito_web: Globe,
  social: Share2,
  analisi: TrendingUp,
};

/** Le etichette corte del menu: il titolo intero del listino non ci sta nella barra. */
// 28/11/2026 01:25 — Nicola: «le voci sono: Foto e video, Gestione social e google, Gestione sitoweb, Analisi di
// mercato». Le etichette stanno in lib/agenzia/servizi-scelti.ts, perché le usa anche il server (l'ordine di SDG,
// l'avviso a Nicola) e la scelta dell'agente.
export { ETICHETTE_SERVIZI };

export { PERCORSO_ABBONAMENTO, hrefServizio };

export type VoceDelMenu = { href: string; icon: LucideIcon; label: string };

export const VOCI_SERVIZI: VoceDelMenu[] = SERVIZI_AGENZIA.map((id) => ({
  href: hrefServizio(id),
  icon: ICONE[id],
  label: ETICHETTE_SERVIZI[id],
}));

/** Il titolo intero del servizio, per la pagina. */
export const titoloServizio = (id: ServizioAgenzia) => LISTINO[id].titolo;
