import {
  MOTIVO_RIPENSAMENTO,
  prodottiDelleRighe,
  rifiutoDelRecesso,
  type ProdottoPerIlRecesso,
  type RigaPerIlRecesso,
} from '@/lib/ordini/recesso';
import { giornoPiacenza } from '@/lib/tempo-piacenza';

/**
 * 1/11/2026 — IL MODULO DI RESO DECIDE COME IL SERVER, PRIMA DI FAR COMPILARE.
 *
 * Due casi in cui il cliente compilava tutto (motivo, note, foto) e poi il
 * server rifiutava:
 *
 * 1. LA SCADENZA. La pagina arrotondava i giorni per difetto (Math.floor > 14:
 *    bloccava solo dopo 15 giorni pieni); la rotta app/api/returns/create usa i
 *    giorni con la virgola (> 14). Esempio: consegna lunedi' 2 alle 10:00, il
 *    cliente apre il modulo lunedi' 16 alle 18:00 — 14,3 giorni: la pagina
 *    diceva «compila», il server «scaduto». E senza data di consegna la pagina
 *    non poneva limiti, mentre il server conta dalla data dell'ordine.
 *    Base = consegna, o l'ordine se la consegna manca (come il server); il
 *    conto dei giorni e' quello di calendario a Roma (vedi sotto).
 *
 * 2. IL RIPENSAMENTO SUL PANE. «Ho cambiato idea» si offriva anche quando tutti
 *    i prodotti sono esclusi dal recesso (products.non_recedibile, migrazione
 *    180): il server lo rifiuta con `rifiutoDelRecesso`. Qui si usa la stessa
 *    funzione, cosi' la voce non compare quando verrebbe rifiutata.
 */
export const GIORNI_DEL_RECESSO = 14;
const UN_GIORNO_MS = 86_400_000;

/**
 * 1/11/2026 (correzione dopo il collaudo) — LA REGOLA DI NICOLA: 14 giorni di
 * CALENDARIO a Roma, fino alle 23:59:59 del 14esimo giorno. Prima si contavano
 * 14x24 ore: consegna lun 2/11 alle 10:00, il cliente che apriva il modulo lun
 * 16/11 alle 18:00 si sentiva dire «scaduto», mentre aveva tempo fino a mezzanotte.
 * Si confrontano le DATE a Roma (giornoPiacenza), non gli istanti: cosi' l'ora
 * della consegna e il cambio d'ora legale non spostano la scadenza.
 * Attenzione: la rotta app/api/returns/create conta ancora 14x24 ore (fuori da
 * questo pacchetto): finche' non usa questa funzione, il 14esimo giorno dopo
 * l'ora della consegna il server puo' ancora rifiutare.
 */
function giorniDiCalendario(da: number, a: number): number {
  const [y1, m1, d1] = giornoPiacenza(da).split('-').map(Number);
  const [y2, m2, d2] = giornoPiacenza(a).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / UN_GIORNO_MS);
}

export type OrdinePerLaScadenza = { delivered_at?: string | null; created_at?: string | null };

export function scadenzaDelRecesso(
  ordine: OrdinePerLaScadenza,
  adesso: number | Date = Date.now(),
): { scaduto: boolean; giorniPassati: number | null } {
  const base = ordine.delivered_at ?? ordine.created_at ?? null;
  if (!base) return { scaduto: false, giorniPassati: null };
  const inizio = new Date(base).getTime();
  if (Number.isNaN(inizio)) return { scaduto: false, giorniPassati: null };
  const giorni = giorniDiCalendario(inizio, typeof adesso === 'number' ? adesso : adesso.getTime());
  return { scaduto: giorni > GIORNI_DEL_RECESSO, giorniPassati: giorni };
}

/** Una riga d'ordine letta dalla pagina, col suo prodotto (se ancora visibile). */
export type RigaDelModulo = RigaPerIlRecesso & {
  products?: (ProdottoPerIlRecesso & { id?: string | null }) | null;
};

/** I prodotti dell'ordine come li conta il server: uno per riga. */
export function prodottiDelModulo(righe: RigaDelModulo[] | null | undefined): ProdottoPerIlRecesso[] {
  const lista = righe ?? [];
  const prodotti = lista
    .map((r) => r.products)
    .filter((p): p is ProdottoPerIlRecesso & { id?: string | null } => !!p);
  return prodottiDelleRighe(lista, prodotti);
}

/** Vero se «Ho cambiato idea» passerebbe il controllo del server. */
export function ripensamentoAmmesso(prodotti: ProdottoPerIlRecesso[]): boolean {
  return rifiutoDelRecesso(MOTIVO_RIPENSAMENTO, prodotti) === null;
}
