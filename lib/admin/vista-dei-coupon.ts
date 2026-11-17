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
import { CODICI_SCONTO_IN_CASSA } from '../funzioni-al-lancio';

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
  /** La scadenza, se c'è: la cassa rifiuta il codice dopo questo istante (check_coupon). */
  expires_at?: string | null;
};

/**
 * 17/11/2026 (R30-025) — «ATTIVO» VOLEVA DIRE SOLO «INTERRUTTORE ACCESO».
 *
 * La pagina guardava solo `active`: un codice scaduto o con tutti gli usi consumati risultava
 * «Attivo», mentre la cassa lo rifiuta (check_coupon guarda expires_at e uses_count >= max_uses).
 * L'amministratore poteva darlo ai clienti credendolo buono. Lo stato qui sotto segue la cassa,
 * nello stesso ordine: spento, poi scaduto, poi esaurito. Ogni riga della vista porta il suo
 * stato e la sua scritta, così la pagina non ha un ramo da scrivere a mano. L'ora la passa chi
 * chiama (`vistaDeiCoupon(q, adesso)`); senza, vale quella del momento.
 */
export type StatoDelCoupon = 'disattivato' | 'scaduto' | 'esaurito' | 'attivo';

export function statoDelCoupon(c: Pick<Coupon, 'active' | 'expires_at' | 'max_uses' | 'uses_count'>, adesso: Date): StatoDelCoupon {
  if (!c.active) return 'disattivato';
  if (c.expires_at) {
    const scade = new Date(c.expires_at).getTime();
    if (Number.isFinite(scade) && scade < adesso.getTime()) return 'scaduto';
  }
  if (c.max_uses != null && c.uses_count >= c.max_uses) return 'esaurito';
  return 'attivo';
}

/** La scritta del badge. «Attivo» dice anche se la cassa i codici li accetta (CODICI_SCONTO_IN_CASSA). */
export function etichettaDelCoupon(stato: StatoDelCoupon, codiciInCassa: boolean = CODICI_SCONTO_IN_CASSA): string {
  if (stato === 'disattivato') return 'Disattivato';
  if (stato === 'scaduto') return 'Scaduto';
  if (stato === 'esaurito') return 'Esaurito';
  return codiciInCassa ? 'Attivo' : 'Attivo (spento in cassa)';
}

/** Una riga della tabella: il coupon letto, col suo stato e la scritta del badge. */
export type CouponInVista = Coupon & { stato: StatoDelCoupon; etichetta: string };

export interface AvvisoLettura {
  titolo: string;
  dettaglio: string;
}

export interface VistaCoupon {
  stato: StatoVista;
  /** Quello che si è potuto leggere. Su una lettura caduta è vuoto, ed è per questo che non si mostra. */
  coupons: CouponInVista[];
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

export function vistaDeiCoupon(q: LetturaQuery<Coupon[]>, adesso: Date = new Date()): VistaCoupon {
  const v = vistaDaQuery<Coupon[]>(q);
  const coupons: CouponInVista[] = (Array.isArray(v.dati) ? v.dati : []).map((c) => {
    const stato = statoDelCoupon(c, adesso);
    return { ...c, stato, etichetta: etichettaDelCoupon(stato) };
  });

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
