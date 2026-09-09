/**
 * «0 CODICI SCONTO» È UN'AFFERMAZIONE — e non si fa su una lettura caduta.
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * `/admin/coupons` leggeva così: `const { data: coupons = [], isLoading } = useQuery(...)`. La
 * funzione di lettura l'errore lo solleva, ma la pagina non lo guardava: `= []` lo trasformava in
 * elenco vuoto, e sotto c'era solo `if (isLoading)`. Il provider di React Query riprova una volta
 * sola e non alza l'errore al confine della pagina, quindi dopo il secondo tentativo `isLoading`
 * torna falso, `data` resta `undefined`, e il ripiego prende il posto del dato.
 *
 * A schermo usciva il titolo «0 codici sconto» sopra una tabella vuota. Nessun avviso, nessun
 * pulsante «Riprova». Una lettura rotta e un pannello davvero vuoto erano identici.
 *
 * ── Perché fa male più di uno schermo bianco ─────────────────────────────────────────────────
 * L'amministratore che apre Coupon dopo un guasto conclude che i codici sono spariti e ne ricrea
 * uno uguale: adesso ce ne sono due, e il secondo nessuno lo sta guardando. Per questo qui, quando
 * la lettura è caduta, non torna solo l'avviso: si spegne anche il pulsante «Nuovo coupon». Il
 * doppione non si previene con una frase, si previene togliendo il pulsante che lo crea.
 *
 * ── La regola, ed è quella di `lib/stato-vista.ts` ───────────────────────────────────────────
 * Gli stati sono QUATTRO, non due: carico · vuoto · rotto · pieno. «Vuoto» si può dire solo dopo
 * aver guardato. Qui la regola arriva fino alla frase sotto al titolo, così la pagina non ha un
 * ramo da scrivere a mano — e quindi non ne ha uno da dimenticare.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio. Una prova lo ESEGUE.
 */

import { vistaDaQuery, type LetturaQuery } from '../vista-query';
import type { StatoVista } from '../stato-vista';

export type CouponTipo = 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';

export type Coupon = {
  id: string;
  code: string;
  type: CouponTipo;
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  uses_count: number;
  first_order_only: boolean;
  active: boolean;
  description: string | null;
};

export interface AvvisoLettura {
  titolo: string;
  dettaglio: string;
}

export interface VistaCoupon {
  stato: StatoVista;
  /** Quello che si è potuto leggere. Su una lettura caduta è vuoto, ed è per questo che non si mostra. */
  coupons: Coupon[];
  /** La riga sotto al titolo. Non dice mai un numero che non abbiamo letto. */
  sottotitolo: string;
  mostraScheletro: boolean;
  mostraVuoto: boolean;
  mostraErrore: boolean;
  /**
   * Il pulsante «Nuovo coupon». Spento finché non sappiamo cosa c'è già: è la riga che impedisce
   * il doppione, non una comodità.
   */
  permettiCreazione: boolean;
  /** Cosa scrivere nel riquadro rosso. `null` quando non c'è niente da ammettere. */
  avviso: AvvisoLettura | null;
}

/** «3 codici sconto», «1 codice sconto». Il plurale sbagliato è la firma di una frase generata. */
export function quantiCodici(n: number): string {
  return n === 1 ? '1 codice sconto' : `${n} codici sconto`;
}

export function vistaDeiCoupon(q: LetturaQuery<Coupon[]>): VistaCoupon {
  const v = vistaDaQuery<Coupon[]>(q);
  const coupons = Array.isArray(v.dati) ? v.dati : [];

  const sottotitolo =
    v.stato === 'rotto'
      ? 'Non sono riuscito a leggere i codici sconto'
      : v.stato === 'carico'
        ? 'Sto leggendo…'
        : quantiCodici(coupons.length);

  return {
    stato: v.stato,
    coupons: v.stato === 'rotto' ? [] : coupons,
    sottotitolo,
    mostraScheletro: v.mostraScheletro,
    mostraVuoto: v.mostraVuoto,
    mostraErrore: v.mostraErrore,
    permettiCreazione: v.stato === 'vuoto' || v.stato === 'pieno',
    avviso: v.mostraErrore
      ? {
          titolo: 'Non riesco a leggere i codici sconto',
          dettaglio:
            'Non vuol dire che non ce ne siano: vuol dire che non li ho potuti guardare. Non crearne uno adesso, rischi di farne due uguali. Riprova fra un momento.',
        }
      : null,
  };
}
