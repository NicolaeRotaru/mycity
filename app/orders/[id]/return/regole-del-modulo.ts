import {
  MOTIVO_RIPENSAMENTO,
  prodottiDelleRighe,
  rifiutoDelRecesso,
  type ProdottoPerIlRecesso,
  type RigaPerIlRecesso,
} from '@/lib/ordini/recesso';

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
 *    Qui il conto e' quello del server, riga per riga: base = consegna, o
 *    l'ordine se la consegna manca; scaduto se sono passati piu' di 14 giorni.
 *
 * 2. IL RIPENSAMENTO SUL PANE. «Ho cambiato idea» si offriva anche quando tutti
 *    i prodotti sono esclusi dal recesso (products.non_recedibile, migrazione
 *    180): il server lo rifiuta con `rifiutoDelRecesso`. Qui si usa la stessa
 *    funzione, cosi' la voce non compare quando verrebbe rifiutata.
 */
export const GIORNI_DEL_RECESSO = 14;
const UN_GIORNO_MS = 86_400_000;

export type OrdinePerLaScadenza = { delivered_at?: string | null; created_at?: string | null };

export function scadenzaDelRecesso(
  ordine: OrdinePerLaScadenza,
  adesso: number = Date.now(),
): { scaduto: boolean; giorniPassati: number | null } {
  const base = ordine.delivered_at ?? ordine.created_at ?? null;
  if (!base) return { scaduto: false, giorniPassati: null };
  const giorni = (adesso - new Date(base).getTime()) / UN_GIORNO_MS;
  return { scaduto: giorni > GIORNI_DEL_RECESSO, giorniPassati: Math.floor(giorni) };
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
