/**
 * «SPESO TOTALE» È UN'AFFERMAZIONE — e non si fa su un pezzo, né su una lettura caduta.
 *
 * ── I due difetti che hanno prodotto questo file ─────────────────────────────────────────────
 * ① Il filtro sta DENTRO la lettura: `if (filter !== 'all') q = q.eq('status', filter)`. Quello
 *    che torna è già ristretto. I quattro riquadri in cima — Campagne, Speso totale, Impressions,
 *    CTR medio — sommavano quella lista e tenevano l'etichetta ferma. Premi «paused» per guardare
 *    le campagne in pausa e il riquadro dei soldi scende: sembra che la spesa pubblicitaria sia
 *    crollata, ed è solo il filtro acceso. Su un riquadro con dentro degli euro, quel malinteso è
 *    il tipo di numero che fa prendere una decisione sbagliata.
 * ② La stessa lettura buttava via l'errore: `const { data } = await q; return data ?? []`. Una
 *    lettura caduta diventava un elenco vuoto, i quattro riquadri scrivevano «0» e «0,00 €», e la
 *    tabella scriveva «Nessuna campagna.». Un guasto e un pannello davvero vuoto avevano lo
 *    stesso aspetto — e il primo dice all'amministratore che i venditori hanno smesso di comprare
 *    pubblicità.
 *
 * ── La malattia è una sola ───────────────────────────────────────────────────────────────────
 * La pagina dava per vero un numero che non aveva verificato: una somma parziale col nome del
 * tutto, e un elenco mai letto chiamato zero. Sono la stessa frase con due oggetti diversi.
 *
 * ── La cura, e perché sta qui e non nella pagina ─────────────────────────────────────────────
 * L'etichetta e il numero escono dalla STESSA funzione, che sa qual è il filtro acceso e quante
 * campagne ci sono davvero là dietro. Non si può più calcolare un pezzo e chiamarlo «totale»,
 * perché non c'è più una scritta da scrivere a mano — e quindi non ce n'è una da dimenticare. La
 * parola «totale» esiste solo quando il perimetro è tutto E il conteggio del database conferma che
 * le abbiamo lette tutte. Senza quella conferma non si afferma: si conta quello che si è letto e
 * lo si dice.
 *
 * Lo stesso vale per il resto: finché non abbiamo guardato, i riquadri mostrano «—», non «0».
 * Zero è una risposta; «—» è l'ammissione che la domanda non ha ancora risposta.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio. Una prova lo ESEGUE.
 */

import { vistaDaQuery, type LetturaQuery } from '../vista-query';
import type { StatoVista } from '../stato-vista';
import { formatPriceFromCents } from '../format';

export type StatoCampagna = 'active' | 'paused' | 'ended';
export type FiltroCampagne = 'all' | StatoCampagna;

export type Campagna = {
  id: string;
  product_id: string | null;
  seller_id: string;
  placement: 'home_top' | 'search_top' | 'category_top';
  category_slug: string | null;
  start_date: string;
  end_date: string;
  daily_budget_cents: number;
  spent_cents: number;
  impressions: number;
  clicks: number;
  status: StatoCampagna;
  product: { name: string | null } | null;
  seller: { store_name: string | null } | null;
};

/**
 * Quello che torna la lettura: le campagne che siamo riusciti a leggere E quante ne conta il
 * database sullo stesso filtro.
 *
 * Il secondo numero non è un lusso. PostgREST tronca le risposte lunghe, quindi «le ho lette
 * tutte» è un'ipotesi finché qualcuno non la verifica: `totale` è la verifica. `null` vuol dire
 * che il conteggio non è stato chiesto — e allora la parola «totale» non si usa.
 */
export interface ElencoCampagne {
  campagne: Campagna[];
  totale: number | null;
}

export type ChiaveRiquadro = 'campagne' | 'speso' | 'impressions' | 'ctr';

export interface RiquadroCampagne {
  chiave: ChiaveRiquadro;
  /** L'etichetta DICE il suo perimetro. Mai «totale» su un pezzo. */
  etichetta: string;
  /** Il valore già pronto per lo schermo. «—» quando non lo sappiamo. */
  valore: string;
  /** Il numero grezzo, per chi lo vuole ricontrollare. `null` quando non lo sappiamo. */
  numero: number | null;
}

export interface AvvisoLettura {
  titolo: string;
  dettaglio: string;
}

export interface VistaCampagne {
  stato: StatoVista;
  /** Le campagne da mostrare. Su una lettura caduta è vuoto, ed è per questo che non si mostra. */
  campagne: Campagna[];
  riquadri: RiquadroCampagne[];
  /** Vero solo quando i riquadri contano TUTTE le campagne. È il permesso di dire «totale». */
  completo: boolean;
  /** La riga sotto ai riquadri: dice che perimetro stanno contando. `null` quando contano tutto. */
  perimetro: string | null;
  /** La riga sotto al titolo. Non dice mai un numero che non abbiamo letto. */
  sottotitolo: string;
  /** Cosa scrivere nella tabella quando abbiamo guardato e non c'è niente. */
  frasePerTabellaVuota: string;
  mostraScheletro: boolean;
  mostraVuoto: boolean;
  mostraErrore: boolean;
  /** Cosa ammettere nel riquadro rosso. `null` quando non c'è niente da ammettere. */
  avviso: AvvisoLettura | null;
}

/** Il trattino lungo: «non lo so», che non è «zero». */
export const SEGNO_NON_SO = '—';

const NOME_BREVE: Record<StatoCampagna, string> = {
  active: 'attive',
  paused: 'in pausa',
  ended: 'finite',
};

const NOME_LUNGO: Record<StatoCampagna, string> = {
  active: `le campagne ${NOME_BREVE.active}`,
  paused: `le campagne ${NOME_BREVE.paused}`,
  ended: `le campagne ${NOME_BREVE.ended}`,
};

function maiuscola(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Come si chiamano i filtri sui pulsanti.
 *
 * Stanno qui, accanto alla riga che spiega il perimetro, perché devono dire la STESSA parola: chi
 * preme «In pausa» deve ritrovare «in pausa» nella frase che gli spiega cosa sta contando. Due
 * parole diverse per la stessa cosa sono un secondo modo di non capirsi.
 */
export const ETICHETTA_FILTRO: Record<FiltroCampagne, string> = {
  all: 'Tutti',
  active: maiuscola(NOME_BREVE.active),
  paused: maiuscola(NOME_BREVE.paused),
  ended: maiuscola(NOME_BREVE.ended),
};

/** Come si chiama lo stato di UNA campagna, nel suo cartellino. */
export function etichettaStato(stato: StatoCampagna): string {
  return stato === 'active' ? 'attiva' : stato === 'paused' ? 'in pausa' : 'finita';
}

/** Come si chiama questa campagna quando la nomini a una persona. */
export function nomeDellaCampagna(c: Pick<Campagna, 'product' | 'seller'>): string {
  const prodotto = c.product?.name?.trim();
  if (prodotto) return prodotto;
  const negozio = c.seller?.store_name?.trim();
  if (negozio) return negozio;
  return 'senza prodotto';
}

type Contabile = Pick<Campagna, 'spent_cents' | 'impressions' | 'clicks'>;

/** La somma dei tre numeri che contano. Un campo non numerico vale zero, non NaN. */
export function sommaDelleCampagne(campagne: readonly Contabile[]): {
  speso: number;
  impressions: number;
  clicks: number;
} {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return campagne.reduce(
    (acc, c) => ({
      speso: acc.speso + n(c.spent_cents),
      impressions: acc.impressions + n(c.impressions),
      clicks: acc.clicks + n(c.clicks),
    }),
    { speso: 0, impressions: 0, clicks: 0 },
  );
}

/**
 * Il rapporto click su visualizzazioni, in percentuale — e `null` quando non esiste.
 *
 * Senza visualizzazioni il rapporto non fa zero: non c'è. Scrivere «0,00%» su zero
 * visualizzazioni è la stessa bugia in piccolo — un numero al posto di un'assenza.
 */
export function ctrPercento(clicks: number, impressions: number): number | null {
  const i = Number(impressions);
  if (!Number.isFinite(i) || i <= 0) return null;
  const c = Number.isFinite(Number(clicks)) ? Number(clicks) : 0;
  return (c / i) * 100;
}

export function vistaDelleCampagne(
  q: LetturaQuery<ElencoCampagne>,
  filtro: FiltroCampagne,
): VistaCampagne {
  const lette = Array.isArray(q.data?.campagne) ? (q.data as ElencoCampagne).campagne : [];
  const v = vistaDaQuery<ElencoCampagne>(q, { quanti: lette.length });

  // «Guardato» vuol dire: la lettura è arrivata e non è caduta. Solo di qui in avanti si possono
  // scrivere numeri; prima si scrive «—».
  const guardato = v.stato === 'pieno' || v.stato === 'vuoto';
  const campagne = guardato ? lette : [];

  const dichiarato = typeof q.data?.totale === 'number' && Number.isFinite(q.data.totale)
    ? Math.max(0, Math.trunc(q.data.totale))
    : null;

  // Il permesso di dire «totale»: abbiamo guardato, il database ci ha detto quante ce ne sono, e
  // ne abbiamo in mano almeno altrettante. Se una delle tre manca, non si afferma.
  const completo = guardato && dichiarato !== null && lette.length >= dichiarato;

  // La riga che decide tutto: un perimetro ristretto — dal filtro o da una risposta troncata —
  // toglie la parola «totale» dalle etichette.
  const parziale = filtro !== 'all' || !completo;
  const coda = filtro === 'all' ? '' : ` · ${NOME_BREVE[filtro]}`;

  const somma = sommaDelleCampagne(campagne);
  const ctr = ctrPercento(somma.clicks, somma.impressions);

  const numeri: Record<ChiaveRiquadro, number | null> = guardato
    ? { campagne: campagne.length, speso: somma.speso, impressions: somma.impressions, ctr }
    : { campagne: null, speso: null, impressions: null, ctr: null };

  const riquadri: RiquadroCampagne[] = [
    {
      chiave: 'campagne',
      etichetta: `Campagne${coda}`,
      numero: numeri.campagne,
      valore: numeri.campagne === null ? SEGNO_NON_SO : String(numeri.campagne),
    },
    {
      chiave: 'speso',
      etichetta: `${parziale ? 'Speso' : 'Speso totale'}${coda}`,
      numero: numeri.speso,
      valore: numeri.speso === null ? SEGNO_NON_SO : formatPriceFromCents(numeri.speso),
    },
    {
      chiave: 'impressions',
      etichetta: `Impressions${coda}`,
      numero: numeri.impressions,
      valore: numeri.impressions === null ? SEGNO_NON_SO : numeri.impressions.toLocaleString('it-IT'),
    },
    {
      chiave: 'ctr',
      etichetta: `${parziale ? 'CTR' : 'CTR medio'}${coda}`,
      numero: numeri.ctr,
      valore: numeri.ctr === null ? SEGNO_NON_SO : `${numeri.ctr.toFixed(2)}%`,
    },
  ];

  return {
    stato: v.stato,
    campagne,
    riquadri,
    completo,
    perimetro: rigaDelPerimetro({ guardato, filtro, completo, lette: lette.length, dichiarato }),
    sottotitolo:
      v.stato === 'rotto'
        ? 'Non sono riuscito a leggere le campagne'
        : v.stato === 'carico'
          ? 'Sto leggendo…'
          : 'Posizionamenti a pagamento acquistati dai venditori.',
    frasePerTabellaVuota:
      filtro === 'all' ? 'Nessuna campagna.' : `Nessuna campagna ${NOME_BREVE[filtro]}.`,
    mostraScheletro: v.mostraScheletro,
    mostraVuoto: v.mostraVuoto,
    mostraErrore: v.mostraErrore,
    avviso: v.mostraErrore
      ? {
          titolo: 'Non riesco a leggere le campagne sponsorizzate',
          dettaglio:
            'Non vuol dire che non ce ne siano: vuol dire che non le ho potute guardare. I riquadri qui sopra restano vuoti apposta — uno «0,00 €» qui direbbe che i venditori hanno smesso di comprare pubblicità, e non lo so. Riprova fra un momento.',
        }
      : null,
  };
}

function rigaDelPerimetro(d: {
  guardato: boolean;
  filtro: FiltroCampagne;
  completo: boolean;
  lette: number;
  dichiarato: number | null;
}): string | null {
  if (!d.guardato) return null;
  if (d.filtro !== 'all' && !d.completo) {
    return `I numeri qui sopra contano solo ${NOME_LUNGO[d.filtro]}, e nemmeno tutte: ne ho lette ${d.lette}${
      d.dichiarato === null ? '' : ` su ${d.dichiarato}`
    }. Premi «Tutti» per il totale.`;
  }
  if (d.filtro !== 'all') {
    return `I numeri qui sopra contano solo ${NOME_LUNGO[d.filtro]}, non tutte. Premi «Tutti» per il totale.`;
  }
  if (!d.completo) {
    return d.dichiarato === null
      ? 'Non so quante campagne ci siano in tutto: i numeri qui sopra contano solo quelle che ho letto.'
      : `Ho letto ${d.lette} campagne su ${d.dichiarato}: i numeri qui sopra contano solo quelle.`;
  }
  return null;
}
