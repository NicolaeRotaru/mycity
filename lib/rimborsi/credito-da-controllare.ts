import { formatPriceFromCents } from '@/lib/format';

/**
 * IL CONTROLLO DEL CREDITO DI UN RIMBORSO, DAL PANNELLO (riesame del 16/10, quarto giro).
 *
 * Quando un rimborso in contanti torna in parte come credito MyCity, `refundOrder` accredita e poi
 * rilegge il diario del credito (`wallet_ledger`) per controllare la cifra. Se quella lettura cade,
 * il rimborso si registra lo stesso (il credito e' gia' uscito) e chi amministra riceve l'avviso
 * «Rimborso col credito da controllare»: «controlla che la riga cod_refund con riferimento … dica
 * X». Ma nessuna pagina del pannello mostrava il diario del credito: il controllo chiesto si poteva
 * fare solo aprendo il database. Adesso l'avviso porta a una pagina che legge quella riga e dice
 * se torna.
 *
 * Qui stanno l'indirizzo della pagina (lo scrive l'avviso) e il verdetto (lo mostra la pagina).
 */

/** La pagina del pannello che fa il controllo. */
export const PAGINA_DEL_CONTROLLO_DEL_CREDITO = '/admin/credito-del-rimborso';

/** Il motivo con cui `refundOrder` scrive l'accredito di un rimborso in contanti. */
export const MOTIVO_DEL_CREDITO_DEL_RIMBORSO = 'cod_refund';

/** L'indirizzo che l'avviso mette sotto il pulsante: chiave del rimborso e cifra attesa. */
export function linkAlControlloDelCredito(chiave: string, attesoCents: number): string {
  const q = new URLSearchParams({ ref: chiave, atteso: String(Math.max(0, Math.round(attesoCents))) });
  return `${PAGINA_DEL_CONTROLLO_DEL_CREDITO}?${q.toString()}`;
}

/** La cifra attesa scritta nell'indirizzo, o `null` se manca o non e' un numero intero. */
export function attesoDallIndirizzo(valore: string | null | undefined): number | null {
  if (valore == null || !/^\d{1,9}$/.test(valore.trim())) return null;
  return Number(valore.trim());
}

export type EsitoDelControllo = 'torna' | 'diverso' | 'assente' | 'senza-atteso';

/**
 * Il verdetto sulla riga del diario. La riga di un rimborso in contanti c'e' una volta sola
 * (indice unico su `ref` per `cod_refund`, migrazione 098): se ne arrivano piu' d'una, si sommano e
 * lo si dice.
 */
export function verdettoDelCredito(
  righe: ReadonlyArray<{ delta_cents: number | null }>,
  attesoCents: number | null,
): { esito: EsitoDelControllo; scrittoCents: number | null; frase: string } {
  if (righe.length === 0) {
    return {
      esito: 'assente',
      scrittoCents: null,
      frase:
        'Nel diario del credito non c’è nessuna riga con questo riferimento: il credito non risulta uscito. ' +
        'Il rimborso però è registrato sull’ordine: al cliente il credito va dato a mano.',
    };
  }
  const scritto = righe.reduce((s, r) => s + Math.round(Number(r.delta_cents ?? 0)), 0);
  const piuRighe = righe.length > 1 ? ` (${righe.length} righe con lo stesso riferimento)` : '';
  if (attesoCents == null) {
    return {
      esito: 'senza-atteso',
      scrittoCents: scritto,
      frase: `Il diario dice ${formatPriceFromCents(scritto)}${piuRighe}. Confrontalo con la cifra dell’avviso.`,
    };
  }
  if (scritto === attesoCents && righe.length === 1) {
    return {
      esito: 'torna',
      scrittoCents: scritto,
      frase: `Torna: il diario dice ${formatPriceFromCents(scritto)}, come il rimborso registrato. Non c’è niente da fare.`,
    };
  }
  return {
    esito: 'diverso',
    scrittoCents: scritto,
    frase:
      `Non torna: il diario dice ${formatPriceFromCents(scritto)}${piuRighe}, il rimborso registrato ` +
      `${formatPriceFromCents(attesoCents)}. La differenza va sistemata a mano sul credito del cliente.`,
  };
}
